# Multiplayer mobile MVP — trạng thái triển khai

## Thông tin chung
- Chế độ A: có code. User yêu cầu trực tiếp bắt đầu triển khai.
- Ngày: 2026-09-15.
- Code nguồn tham chiếu: `../drinking_game/`.
- Tài liệu: `docs/` theo yêu cầu mới của user, thay cho MyDocs.
- Git: thư mục đích chưa có repository hoặc remote; không có nhánh để fetch/pull.

## Yêu cầu gốc (nguyên văn)
> dua tren folder drinking_game trong ~/Learing/drinking_game/ xay dung 1 phien ban drinking_game_mobile voi react native, tailwind native, expo go; trong nay toi can 1 server websocket nham cap nhat realtime dien bien tro choi voi nhieu may, game nay se da nen tang luon, toi can 1 ban web native va 1 ban ark, su dung expo go de toi co the xem UI va test duoc, data luu trong localstorage cua may (co hop ly khong hay can luu data rieng? vi chi can luu tien trinh hien tai cua luot choi hien tai va hien thi cho tat ca cac nguoi choi dang vao chung 1 kenh); y tuong phien ban nay se la, moi nguoi choi vao ung dung nay se phai nhap ten cua minh -> chuyen den trang phong, co the tao phong hoac join phong, tao phong thi nhap ten phong + mat khau, nguoi join phong thi nhap dung mat khau se duoc tham gia vao cung 1 phien choi voi nhung nguoi choi khac (se khac phien ban o drinking_game/ la phai nhap ten nguoi choi thu cong va chon so luong nguoi choi thu cong), bo bai mac dinh 50 la tat ca chu phong deu thay, khi tao phong chu phong co the dua tren bo bai do, them bai moi, sua noi dung cac la cu hoac xoa bot ra khoi bo bai => len plan giup toi

## Nhật ký duyệt
- User: “chot cac phuong an ban de xuat, bat dau trien khai” — chốt Expo/NativeWind, NestJS/Socket.IO, MySQL 8.4, Docker Compose; cho phép triển khai phương án đã trao đổi.
- User: “phan tai lieu cua project nay co the nam luon trong project, khong can dua vao MyDocs/” — lưu tài liệu trong dự án.
- Chưa có duyệt riêng cho các quy ước MVP dưới đây; đây là mặc định triển khai, có thể điều chỉnh.

## Quy ước MVP
- 2–12 người, chỉ join mới/sửa deck tại lobby; reconnect thành viên cũ ở mọi giai đoạn.
- 50 lá đầu của bộ 60 lá thật; nhóm lucky chưa nằm trong mặc định 50 lá, editor hỗ trợ cả 7 nhóm.
- Mỗi vòng chia số lá bằng số người đang hoạt động; đúng lượt mới được chọn/hoàn thành.
- Mật khẩu scrypt; token ngẫu nhiên chỉ lưu hash trong MySQL.
- MySQL lưu aggregate JSON mỗi phòng, khóa hàng trong transaction, revision và receipt chống gửi trùng.
- Phòng hết hạn 24 giờ sau thao tác thay đổi cuối; session 30 ngày; dọn mỗi phút.
- Lịch sử giữ tối đa 500 lượt; giao diện hiển thị 20 lượt gần nhất.
- Người chơi rời chủ động thì chuyển quyền chủ phòng. Mất mạng chỉ đánh dấu offline, giữ chỗ; chưa tự chuyển quyền chủ phòng offline.
- Thống kê số ngụm dành cho người đang ở lượt, luật chỉ định người khác thực hiện trực tiếp giống bản cũ.

## Tiến độ
- Đã đọc bản cũ, xây backend, UI đa nền tảng và Docker Compose.
- Backend + MySQL đã chạy healthy. Unit 7/7, integration với MySQL/Socket.IO 1/1 đã đạt.
- TypeScript đạt; export web, Android và iOS đạt. Export native chưa phải APK.
- Playwright hai trình duyệt độc lập đã đạt (1/1), bao gồm thêm/sửa/xóa bài, sai mật khẩu, lượt chơi và reload.
- Integration đã đạt 2/2: thêm test dừng và khởi động backend process mới, khôi phục lá đang mở từ MySQL.
- Expo dev server đã bật ở cổng 8081; backend cổng 3000. LAN hiện tại 192.168.1.239.
- Tài liệu: [Triển khai & chạy thử](implementation.html), [Kế hoạch GitHub và Linux](deployment-plan.html).
- Đã chuẩn bị compose.production.yaml, Dockerfile web và Caddyfile; kiểm tra compose config và build image web đã đạt. Chưa deploy VPS thật.

## Chưa xác minh / còn nợ
- Expo Go trên điện thoại thật; APK qua EAS cần tài khoản Expo và địa chỉ backend truy cập được. `eas whoami` trả về `Not logged in`, chưa có APK.
- Chưa triển khai production HTTPS, backup và thử tải.
- Chưa có sơ đồ rendered; sẽ ghi thiết kế hiện trạng trong tài liệu HTML.
