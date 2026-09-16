# Deploy Chạm Ly lên server production

Runbook triển khai stack production (MySQL + API NestJS + web tĩnh sau Caddy) lên một server
Linux mới và public ra domain bằng Cloudflare Tunnel.

Ví dụ trong tài liệu dùng domain `chamly.banhchungranchaydenxi.click`. Thay bằng domain thật
của server đích ở mọi chỗ xuất hiện.

---

## 0. Câu hỏi thường gặp trước khi bắt đầu

### Cloudflare Tunnel chạy ở đâu cũng được không?

Không hẳn. `cloudflared` phải chạy ở nơi **kết nối được tới origin**. File ingress trỏ tới
`http://localhost:45104`, nên tiến trình `cloudflared` phải nằm trên chính server chạy Docker.
Nếu chạy `cloudflared` trên laptop trong khi app nằm ở server khác, `localhost` sẽ là laptop
và tunnel trả 502.

Ngoại lệ: nếu hai máy cùng mạng nội bộ, ingress có thể trỏ `http://192.168.1.50:45104` và
`cloudflared` chạy trên máy còn lại. Cách này thêm một điểm hỏng không cần thiết — với deploy
production, chạy `cloudflared` ngay trên server là lựa chọn mặc định.

### Có phải cài lại cloudflared CLI và login lại trên server mới không?

**Không cần `cloudflared tunnel login` lại.** Lệnh login sinh ra `~/.cloudflared/cert.pem` —
chứng chỉ quản trị dùng cho các thao tác *tạo* tunnel, *xóa* tunnel và *tạo DNS route*. Việc
**chạy** một tunnel đã tồn tại chỉ cần file credentials `<TUNNEL-UUID>.json`.

Có ba cách đưa tunnel lên server mới, chọn một:

| Cách | Cần gì trên server | Ingress cấu hình ở đâu | Phù hợp khi |
|---|---|---|---|
| **A. Container trong Compose** | Không cài gì thêm | `config.yml` trong repo | Mặc định cho project này |
| **B. Binary trên host** | Cài package `cloudflared` | `~/.cloudflared/config.yml` | Muốn tunnel sống độc lập với Docker |
| **C. Token từ dashboard** | Không cài gì thêm | Giao diện Cloudflare Zero Trust | Không muốn copy file credentials |

Cách A và C **không cần cài CLI trên server**. Cách B cần cài binary, nhưng vẫn không cần login.

### Cảnh báo quan trọng: đừng chạy cùng một tunnel ở hai máy

Cloudflare cho phép nhiều connector đăng ký cùng một tunnel và sẽ **chia tải ngẫu nhiên** giữa
chúng. Nếu laptop cũ vẫn chạy `cloudflared` với cùng UUID trong khi server mới cũng chạy, request
sẽ rơi ngẫu nhiên vào một trong hai máy — dữ liệu phân mảnh giữa hai database khác nhau và lỗi
rất khó chẩn đoán.

Khi chuyển sang server mới: **tắt tunnel ở máy cũ trước**, hoặc tạo tunnel riêng cho server mới
bằng `cloudflared tunnel create chamly-prod`.

---

## 1. Yêu cầu trên server đích

- Linux x86_64 có Docker Engine và Docker Compose v2 (`docker compose version` ≥ v2.20).
- Kết nối Internet ra ngoài, không bị chặn outbound port `7844` (QUIC/HTTP2 tới Cloudflare).
- Không cần mở port inbound, không cần public IP, không cần port-forward.
- Domain đã Active trên Cloudflare (nameserver đã trỏ về Cloudflare).

Kiểm tra nhanh:

```bash
docker compose version
curl -s https://api.cloudflare.com/client/v4/ips >/dev/null && echo "outbound OK"
```

---

## 2. Lấy mã nguồn và tạo file môi trường

```bash
git clone <repo-url> ~/chamly && cd ~/chamly
cp .env.production.example .env.production
```

Sinh mật khẩu ngẫu nhiên rồi điền vào `.env.production`:

```bash
openssl rand -hex 24   # cho MYSQL_PASSWORD
openssl rand -hex 24   # cho MYSQL_ROOT_PASSWORD (phải khác mật khẩu trên)
```

Nội dung `.env.production`:

```bash
APP_DOMAIN=chamly.banhchungranchaydenxi.click
API_DOMAIN=chamly.banhchungranchaydenxi.click
ACME_EMAIL=admin@banhchungranchaydenxi.click
MYSQL_DATABASE=chamly
MYSQL_USER=chamly
MYSQL_PASSWORD=<chuỗi vừa sinh>
MYSQL_ROOT_PASSWORD=<chuỗi khác vừa sinh>
RELEASE_TAG=v0.1.0
WEB_PORT=45104
```

Giải thích các biến quan trọng:

- **`APP_DOMAIN` và `API_DOMAIN` để cùng một giá trị.** Caddy trong image web route cả trang
  tĩnh lẫn `/socket.io`, `/health`, `/sessions` về API, nên một hostname là đủ. `API_DOMAIN` được
  dùng làm `EXPO_PUBLIC_API_URL` lúc build frontend; `APP_DOMAIN` được dùng làm `CORS_ORIGINS`
  của API.
- **`WEB_PORT`** là port trên host mà Caddy lắng nghe, và là port mà ingress của tunnel trỏ tới.
  Compose bind nó vào `127.0.0.1` nên không lộ ra ngoài LAN.
- **`ACME_EMAIL`** hiện không được dùng để xin chứng chỉ: TLS kết thúc tại Cloudflare edge, Caddy
  chỉ phục vụ HTTP trên cổng 80 trong container. Biến vẫn bắt buộc có giá trị vì compose khai báo
  `:?`.

`.env.production` chứa mật khẩu database — file này nằm trong `.gitignore`, không commit.

---

## 3. Build và chạy stack

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --wait
docker compose --env-file .env.production -f compose.production.yaml ps
```

`--wait` chờ tới khi healthcheck của `db` và `api` chuyển sang healthy rồi mới trả về, nên lệnh
thất bại ngay nếu database không lên được, thay vì im lặng để lại container hỏng.

Xác minh origin trước khi động tới tunnel:

```bash
curl -i http://127.0.0.1:45104/           # trang web, mong đợi 200
curl -i http://127.0.0.1:45104/health     # API qua Caddy, mong đợi {"status":"ok"}
```

Nếu bước này chưa 200 thì mọi cấu hình tunnel phía sau đều vô nghĩa, và triệu chứng sẽ hiện ra
dưới dạng lỗi 502 gây hiểu nhầm là lỗi mạng Cloudflare.

### Lưu ý khi đổi domain

`EXPO_PUBLIC_API_URL` được nhúng thẳng vào bundle JavaScript lúc build (`apps/mobile/Dockerfile`).
Đổi `API_DOMAIN` trong `.env.production` rồi chỉ `up -d` là **không đủ** — bundle cũ vẫn giữ URL
cũ. Phải build lại image web:

```bash
docker compose --env-file .env.production -f compose.production.yaml build --no-cache web
docker compose --env-file .env.production -f compose.production.yaml up -d web
```

---

## 4. Cấu hình Cloudflare Tunnel

Chọn một trong ba cách ở mục 0. Cách A là mặc định khuyến nghị cho project này.

### Cách A — cloudflared chạy như một service trong Compose

Không cần cài gì lên host server. Copy hai file từ máy đã login sẵn sang server:

```bash
# chạy trên máy cũ (đã có cert.pem và đã tạo tunnel)
scp ~/.cloudflared/<TUNNEL-UUID>.json user@server:~/chamly/deploy/cloudflared/
scp ~/.cloudflared/config.yml         user@server:~/chamly/deploy/cloudflared/
```

Sửa `deploy/cloudflared/config.yml` cho môi trường container — bên trong Docker network,
origin không còn là `localhost` mà là tên service `web`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /etc/cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: chamly.banhchungranchaydenxi.click
    service: http://web:80

  - service: http_status:404
```

Thêm service vào `compose.production.yaml`:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --config /etc/cloudflared/config.yml run
    volumes:
      - ./deploy/cloudflared:/etc/cloudflared:ro
    depends_on:
      web: { condition: service_started }
    logging:
      options: { max-size: '10m', max-file: '3' }
```

Thư mục `deploy/cloudflared/` chứa credentials — thêm vào `.gitignore`, không commit.

Khi dùng cách này, `WEB_PORT` publish ra host không còn bắt buộc (tunnel đi thẳng qua Docker
network), nhưng giữ lại thì tiện cho việc kiểm tra bằng `curl` trên server.

### Cách B — cloudflared là binary trên host

Cài package rồi copy credentials, không cần login:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

mkdir -p ~/.cloudflared
# copy <TUNNEL-UUID>.json và config.yml từ máy cũ sang ~/.cloudflared/
chmod 600 ~/.cloudflared/<TUNNEL-UUID>.json
```

`config.yml` giữ nguyên `service: http://localhost:45104`. Kiểm tra rồi chạy:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml ingress validate
cloudflared tunnel --config ~/.cloudflared/config.yml run chamly
```

Muốn tự chạy cùng máy: `sudo cloudflared --config /home/<user>/.cloudflared/config.yml service install`
rồi `sudo systemctl enable --now cloudflared`. Đường dẫn config phải ghi tuyệt đối vì `sudo`
đổi `HOME` thành `/root`.

### Cách C — tunnel quản lý từ dashboard bằng token

Tạo tunnel trong Cloudflare Zero Trust → Networks → Tunnels, khai báo public hostname trỏ tới
`http://web:80` (hoặc `http://localhost:45104`), rồi copy token. Trên server chỉ cần:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?Set TUNNEL_TOKEN}
```

Không có file credentials nào phải copy, không cần `cert.pem`, không cần CLI. Đổi lại, ingress
không nằm trong repo mà chỉ tồn tại trên dashboard, nên cấu hình routing không được version.

---

## 5. Tạo DNS route cho hostname

Mỗi hostname cần route **một lần duy nhất**, thực hiện từ bất kỳ máy nào có `cert.pem`
(thường là máy đã login ban đầu, không nhất thiết là server):

```bash
cloudflared tunnel route dns chamly chamly.banhchungranchaydenxi.click
dig +short chamly.banhchungranchaydenxi.click
```

Lệnh tạo một CNAME proxied trỏ hostname tới `<TUNNEL-UUID>.cfargotunnel.com`. Nếu hostname đã
được route trước đó (ví dụ khi chuyển từ laptop sang server cùng tunnel), bước này bỏ qua —
record vẫn trỏ đúng tunnel, chỉ đổi máy chạy connector.

Với cách C, DNS record được tạo tự động khi khai báo public hostname trên dashboard.

---

## 6. Kiểm tra sau deploy

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f cloudflared

curl -i https://chamly.banhchungranchaydenxi.click/health
curl -i -X POST https://chamly.banhchungranchaydenxi.click/sessions \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://chamly.banhchungranchaydenxi.click' \
  -d '{"name":"smoke-test"}'
curl -i "https://chamly.banhchungranchaydenxi.click/socket.io/?EIO=4&transport=polling"
```

Mong đợi: `/health` trả `200` với `{"status":"ok"}`, `/sessions` trả `201` kèm token, `/socket.io/`
trả `200`. Sau đó mở domain trên trình duyệt và tạo thử một phòng chơi để xác nhận WebSocket
hoạt động — polling trả 200 chưa chứng minh được kênh realtime đã thông.

---

## 7. Vận hành

```bash
# xem log
docker compose --env-file .env.production -f compose.production.yaml logs -f api

# cập nhật phiên bản mới
git pull
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --wait

# tắt stack, giữ dữ liệu MySQL
docker compose --env-file .env.production -f compose.production.yaml down

# backup database
docker compose --env-file .env.production -f compose.production.yaml exec -T db \
  mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" chamly > backup-$(date +%F).sql
```

`down` giữ nguyên volume `mysql_data`. Chỉ `down -v` mới xóa dữ liệu — không chạy trên
production trừ khi có chủ đích.

---

## 8. Xử lý lỗi

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| **Error 1033** trên trình duyệt | DNS đã trỏ tunnel nhưng không có connector nào đang chạy | Kiểm tra `cloudflared tunnel info <tên>`; khởi động lại tiến trình/container cloudflared |
| **502 Bad Gateway** | Tunnel online nhưng không với tới origin | `curl http://127.0.0.1:45104/health` trên server; kiểm tra `service:` trong ingress đúng host và port |
| **404 từ tunnel** | Hostname không khớp rule ingress nào, rơi vào catch-all | `cloudflared tunnel ingress rule https://<hostname>/` để xem rule nào khớp |
| **CORS bị chặn trên trình duyệt** | `CORS_ORIGINS` chưa chứa domain public | Sửa `APP_DOMAIN` trong `.env.production`, `up -d api` |
| **Frontend gọi API sai domain** | Bundle cũ còn nhúng URL cũ | Build lại image web với `--no-cache` (mục 3) |
| **Request rơi ngẫu nhiên giữa hai môi trường** | Cùng một tunnel UUID chạy ở hai máy | Tắt connector ở máy không mong muốn |
| **cloudflared không kết nối được** | Outbound port 7844 bị firewall chặn | Kiểm tra firewall; log cloudflared sẽ báo QUIC/HTTP2 thất bại |

---

## 9. Tham chiếu

| Tập tin | Nội dung |
|---|---|
| `compose.production.yaml` | Định nghĩa stack production: db, api, web |
| `.env.production.example` | Mẫu biến môi trường, copy thành `.env.production` |
| `deploy/Caddyfile` | Routing trong image web: tĩnh + proxy `/socket.io`, `/health`, `/sessions`, `/auth/*` |
| `apps/api/Dockerfile` | Build API NestJS multi-stage |
| `apps/mobile/Dockerfile` | Build web tĩnh bằng Expo rồi đóng gói cùng Caddy |
| `docs/deployment-plan.html` | Kế hoạch triển khai chi tiết |
| `~/Documents/MyDocs/Cloudflare/CloudflareTunnels/cloudflare-tunnel-cli.html` | Hướng dẫn Cloudflare Tunnel đầy đủ, gồm case study app chạy bằng PM2 |
