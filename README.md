# Dưới Ánh Trăng · Trung Thu 2026

Website Trung Thu chạy bằng HTML, CSS và JavaScript, không cần build.

## Chạy trên máy

Mở terminal trong thư mục dist và chạy `python -m http.server 4173`, sau đó mở http://localhost:4173.

## Tính năng

Nhập tên; đèn lồng bay, sao lấp lánh; nhạc tổng hợp nhẹ; mở quà một lần trên trình duyệt; gửi lời chúc công khai hoặc riêng tư; ẩn tên; bầu trời tương tác; danh sách lời chúc; trang cá nhân; tải ảnh PNG; chia sẻ và mã QR.

## Phạm vi bản trải nghiệm

Dữ liệu lưu bằng localStorage trên từng trình duyệt. Các lời chúc mẫu được gắn nhãn Minh họa. Không có dữ liệu dùng chung, quản trị hay kiểm duyệt máy chủ. Xóa dữ liệu trình duyệt sẽ xóa kết quả. Đổi thiết bị không khôi phục được lượt mở quà. Nhạc được tạo bằng Web Audio, không sử dụng bản ghi có bản quyền.

Mã QR trong assets/qr.svg trỏ đến địa chỉ Sites riêng tư của bản này. Khi triển khai GitHub Pages hoặc đổi tên miền, cần thay mã QR tương ứng.

## Giai đoạn kết nối Supabase

Tạo bảng visitors, wishes, wish_claims, reports; dùng Supabase Auth anonymous hoặc cơ chế định danh có xác thực, RLS, RPC giao dịch bốc quà và ràng buộc duy nhất trên người nhận. Không dùng UUID do client cung cấp như bằng chứng xác thực. Không đặt service role key trong frontend. Bản hiện tại không cần khóa API.

## Tài nguyên

Ba hình minh họa được tạo riêng cho dự án; Google Fonts: Charm và Be Vietnam Pro. Trình duyệt sử dụng phông dự phòng khi không kết nối được Google Fonts. Thiết lập prefers-reduced-motion giảm hiệu ứng chuyển động.
