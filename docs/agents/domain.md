# Domain docs

Quy tắc đọc tài liệu domain khi các engineering skill khám phá codebase.

## Layout: single-context

- `CONTEXT.md` ở thư mục gốc: thuật ngữ và mô hình domain dùng chung.
- `docs/adr/`: các quyết định kiến trúc của dự án.

## Trước khi khám phá codebase

1. Đọc `CONTEXT.md` nếu có.
2. Đọc các ADR trong `docs/adr/` liên quan đến phần sắp làm.

Nếu tài liệu chưa tồn tại, tiếp tục bình thường, không cảnh báo hoặc đề xuất
tạo trước. Skill /domain-modeling sẽ tạo khi thuật ngữ hoặc quyết định
thực sự được chốt, bao gồm khi được gọi qua /grill-with-docs hoặc
/improve-codebase-architecture.

## Dùng đúng thuật ngữ

Khi đặt tên khái niệm domain trong issue, đề xuất refactor, giả thuyết
hoặc tên test, dùng thuật ngữ được định nghĩa trong `CONTEXT.md`.
Tránh các từ đồng nghĩa mà glossary đã loại trừ.

Nếu thiếu khái niệm cần dùng, kiểm tra lại cách gọi.
Nếu thực sự thiếu thuật ngữ, ghi nhận để /domain-modeling xử lý.

## Nêu rõ xung đột với ADR

Nếu đề xuất mâu thuẫn với ADR hiện có, chỉ rõ ADR và lý do cần xem xét lại.

Ví dụ: "Mâu thuẫn với ADR-0007 — đề xuất xem xét lại vì…"
