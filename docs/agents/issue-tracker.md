# Issue tracker: Local Markdown

Issue và spec của dự án được lưu dưới dạng file Markdown trong `.scratch/`.

## Quy ước

- Mỗi tính năng có một thư mục: `.scratch/<feature-slug>/`.
- Spec: `.scratch/<feature-slug>/spec.md`.
- Mỗi ticket triển khai có một file riêng:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, đánh số từ `01`.
- Trạng thái triage được ghi bằng dòng `Status:` gần đầu file issue.
  Giá trị trạng thái được định nghĩa trong `triage-labels.md`.
- Bình luận và lịch sử trao đổi được nối vào cuối file dưới mục `## Comments`.

## Khi skill yêu cầu "publish to the issue tracker"

Tạo file theo quy ước trên; tạo thư mục chứa nếu cần.

## Khi skill yêu cầu "fetch the relevant ticket"

Đọc file theo đường dẫn được cung cấp.
Nếu chỉ có số ticket, tìm trong thư mục tính năng đang làm.
Nếu nhiều ticket cùng số và chưa rõ tính năng, hỏi người dùng để xác định.

## Các thao tác của /wayfinder

- Map: `.scratch/<effort>/map.md`, chứa các mục
  Notes / Decisions-so-far / Fog.
- Ticket con: `.scratch/<effort>/issues/<NN>-<slug>.md`,
  đánh số từ `01`, chứa câu hỏi cần giải quyết.
- Dòng `Type:` ghi loại ticket: `research`, `prototype`, `grilling` hoặc `task`.
- Ticket wayfinder dùng vòng đời riêng qua `Status:`:
  `open`, `claimed`, `resolved`.
- Phụ thuộc: dòng `Blocked by: NN, NN` gần đầu file.
  Ticket hết bị chặn khi mọi ticket được liệt kê đều `resolved`.
- Frontier: tìm ticket `open`, không bị chặn; ưu tiên số nhỏ nhất.
- Claim: đổi thành `Status: claimed` và lưu trước khi bắt đầu làm.
- Resolve: thêm câu trả lời dưới `## Answer`, đổi thành `Status: resolved`,
  rồi thêm tóm tắt kèm liên kết vào mục Decisions-so-far của map.
