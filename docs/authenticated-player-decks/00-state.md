# Tài khoản người chơi và bộ bài cá nhân — trạng thái pipeline

> File này là nguồn sự thật duy nhất về việc đang ở bước nào.

## Thông tin chung

| Mục | Giá trị |
|---|---|
| Tên việc | Tài khoản người chơi và bộ bài cá nhân |
| Chế độ | A (có code) |
| Ngày bắt đầu | 2026-09-16 |
| Thư mục tài liệu | `docs/authenticated-player-decks/` |
| Repo code liên quan | `drinking_game_mobile` |
| Cho phép render sơ đồ qua plantuml.com? | không (dùng bản local) |

## Yêu cầu gốc của user (nguyên văn — không diễn giải lại)

```
1. o main da co full code moi chua? prod duoc build dua tren nhanh hay tren main? neu tren nhanh can luu y app chay tren production thi phai build tren main
2. toi muon doi co che 1 chut, nguoi choi gio day khong don thuan la chi nhap ten nua, la tao tai khoan moi, server backend gio quan ly ca nguoi dung, toi muon moi nguoi choi co the quan ly bo bai cua ho, khi tao phong, voi game tuong ung ma chua co bo bai nao de bat dau game (hoac ke ca da co) nguoi choi co the chon bo bai default cua he thong de clone va chinh sua tu do hoac tao 1 bo bai moi tinh theo y cua minh
```

## Tiến độ

| Bước | Nội dung | Trạng thái | File | Ngày duyệt |
|---|---|---|---|---|
| 0 | Khởi tạo | ✅ xong | `00-state.md` | 2026-09-16 |
| 1 | Phân tích nghiệp vụ | ✅ đã duyệt | `01-phan-tich.html` | 2026-09-16 |
| 2 | Giải pháp + US/AC | ✅ đã duyệt lại | `02-giai-phap-us-ac.html` | 2026-09-16 |
| 3 | Sơ đồ | ✅ đã duyệt | `03-so-do.html` | 2026-09-16 |
| 4 | Triển khai | ✅ code xong (không xuất `04-handoff.md`, chọn nhánh "tôi code") | — | |
| 5 | Kiểm thử | 🟡 báo cáo đã viết, chờ user xác nhận | `05-bao-cao-test.html` | |
| 6 | Chốt | ⬜ | — | |

**Đang ở bước:** 5
**Đang chờ:** user đọc `05-bao-cao-test.html` và xác nhận 3 điểm nêu ở mục "Việc còn nợ" của báo cáo đó (đặc biệt là sub-test admin fail do thiếu `ADMIN_PASSWORD` ở tiến trình dev đang chạy nền) trước khi sang bước 6 (chốt + merge `main`).

## Nhật ký cổng duyệt

| Cổng | Ngày | Kết quả | Ghi chú của user |
|---|---|---|---|
| Khởi tạo | 2026-09-16 | Duyệt chế độ B | Chọn "Phân tích trước". |
| 1 | 2026-09-16 | Duyệt | Yêu cầu hiện thực hóa ý tưởng; sau test sẽ merge vào `main` và build production từ `main`. |
| 2 | 2026-09-16 | Duyệt | Chuyển step 3. |
| 2 (cập nhật) | 2026-09-16 | Duyệt | Username sinh từ tên hiển thị, bất biến; bổ sung trang cá nhân, đổi mật khẩu, đổi tên 7 ngày. |
| 3 | 2026-09-16 | Duyệt | Yêu cầu dùng PlantUML server local, chỉnh sửa sơ đồ và chuyển Step 4. |
| 4 | 2026-09-16 | Tôi code | User yêu cầu trực tiếp triển khai. |
| 4→5 | 2026-09-16 | Đã rà soát + code tiếp | Phiên làm việc tiếp theo (đã kiểm tra `docs/authenticated-player-decks/` theo yêu cầu user) phát hiện toàn bộ US-01..US-07 đã được code từ trước; đã sửa bug e2e (nhãn/luồng đăng nhập cũ trong `tests/*.spec.ts` không khớp UI mới), bổ sung test còn thiếu cho một số AC, và viết `05-bao-cao-test.html`. Ngoài phạm vi ban đầu, user yêu cầu thêm 2 việc nhỏ ở màn sảnh: (1) khung "Các phòng hiện tại" ban đầu làm chiều cao cố định + cuộn lồng bên trong, nhưng user phản hồi cuộn lồng gây xung đột thao tác chạm trên mobile web — đã đổi sang mẫu "Xem thêm N phòng" (hiện 3 phòng đầu, bấm để mở rộng, không còn ScrollView lồng nhau); (2) thêm nút nổi "↑ Lên đầu trang" chỉ hiện trên web khi cuộn xuống quá 400px. Cả hai đã kiểm tra bằng ảnh chụp Playwright. |

## Quyết định đã chốt

| Quyết định | Lý do | Bước |
|---|---|---|
| Tài liệu nằm trong repository | Quy ước riêng của dự án. | 0 |
| Sản phẩm production phải build từ `main` | Yêu cầu trực tiếp. | 0 |
| Chuyển sang chế độ A | User yêu cầu hiện thực hóa sau bước phân tích. | 1 |
| Production chỉ cập nhật sau khi test đạt và merge vào `main` | Tránh phát hành trực tiếp từ nhánh tính năng. | 1 |
| Username là định danh đăng nhập ban đầu | Duyệt phương án A ở Cổng 2. | 2 |
| Môi trường dev chạy liên tục khi code | User kiểm tra realtime và phản hồi theo từng mốc. | 2 |
| Username do hệ thống sinh từ tên hiển thị, duy nhất, không rỗng và bất biến | Yêu cầu trực tiếp; cần cập nhật mô hình đăng ký và tài khoản. | 2 |

## Giả định chưa kiểm chứng

| Giả định | Ảnh hưởng nếu sai | Đã xác nhận? |
|---|---|---|
| Một tài khoản có thể sở hữu nhiều bộ bài, phân theo game. | Ảnh hưởng mô hình dữ liệu và UI quản lý. | Đã đúng — `user_decks` có `pack_id`, `decks:list` lọc theo pack, test tại `integration.test.ts:246-252`. |
| Bộ bài mặc định của hệ thống chỉ dùng làm mẫu clone, không sửa trực tiếp. | Ảnh hưởng quyền sở hữu và cơ chế cập nhật nội dung hệ thống. | Đã đúng — không có API nào ghi vào `default_decks`; test `integration.test.ts:298-300` xác nhận sửa deck clone không đổi mẫu mặc định. |
| Username sinh từ tên hiển thị được hậu tố tăng dần khi base username đã tồn tại. | Ảnh hưởng quy tắc sinh username và trải nghiệm người dùng. | Đã đúng — `Store.register` lặp hậu tố số khi `ER_DUP_ENTRY`; xác nhận qua code, chưa có test riêng cho trường hợp trùng tên vì cần 2 tài khoản cùng tên hiển thị (rủi ro thấp, không chặn merge). |

## Phát sinh ngoài phạm vi

| Nội dung | Phát hiện ở bước | Đề xuất |
|---|---|---|
| Khung "Các phòng hiện tại" ở màn sảnh không giới hạn chiều cao — danh sách dài đẩy nội dung khác xuống rất xa. | User yêu cầu trực tiếp giữa bước 5. | Đã làm luôn (nhỏ, cùng màn hình, không đổi API/dữ liệu). Bản đầu dùng `maxHeight` + `ScrollView` lồng bên trong; user chỉ ra cuộn lồng dễ gây xung đột thao tác chạm trên mobile web nên đã đổi sang nút "Xem thêm N phòng" (hiện 3 phòng đầu, không còn cuộn lồng) tại `apps/mobile/src/App.tsx`. |
| Cuộn trang dài trên bản web không có cách nhanh để quay lại đầu trang. | User yêu cầu trực tiếp giữa bước 5. | Đã làm: nút nổi "↑" ở góc dưới phải, chỉ hiện trên `Platform.OS === 'web'` khi đã cuộn xuống quá 400px, bấm để cuộn mượt về đầu (`apps/mobile/src/App.tsx`). |
| Luồng phiên ẩn danh cũ (`POST /sessions`, chỉ nhập tên) không còn lối vào từ UI nhưng vẫn còn trong backend. | Phát hiện khi viết `05-bao-cao-test.html`. | Cần user quyết định: giữ để tương thích ngược hay gỡ hẳn — xem mục "Việc còn nợ" bên dưới. |

## Việc còn nợ

| Việc | Vì sao chưa làm |
|---|---|
| Sub-test `admin.spec.ts > admin dashboard lists rooms and can manage them` đang fail. | Không phải lỗi code — tiến trình API dev chạy nền thiếu biến môi trường `ADMIN_PASSWORD` (xác nhận qua `/proc/<pid>/environ`). Cần user xác nhận có nên khởi động lại tiến trình đó không (có thể đang được phiên làm việc khác dùng). Chi tiết ở `05-bao-cao-test.html#no`. |
| Quyết định giữ hay gỡ luồng phiên ẩn danh cũ (`POST /sessions`). | Cần user xác nhận — chưa rõ có thiết bị nào còn dùng bản UI cũ hay không. |
| `04-handoff.md` không tồn tại. | Không phải thiếu sót — user chọn nhánh "tôi code" ở cổng 4 nên không cần file bàn giao. |
| | |
