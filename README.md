# Dưới Ánh Trăng · Trung Thu 2026

Website tương tác Trung Thu thuần HTML, CSS và JavaScript hiện đại, không cần build step, cấu trúc 7 trang tĩnh độc lập kết hợp điều hướng PJAX giữ âm thanh phát liên tục xuyên suốt.

## Cách chạy thử nghiệm

Mở terminal trong thư mục `dist` và chạy lệnh:
```bash
python -m http.server 4173
```
Sau đó mở trình duyệt tại: [http://localhost:4173](http://localhost:4173).

## Cấu trúc 7 trang chuyên biệt

- `index.html`: Trang chủ đón chào, hiển thị lời chúc theo tên, mở quà 1 chạm và 4 lối tắt điều hướng nhanh.
- `gift.html`: Không gian mở hộp quà Trung Thu tương tác, hiệu ứng bung toả ánh sao và lời nhắn nhủ.
- `write.html`: Không gian viết lời chúc dưới ánh trăng trên phong thư hoa văn cổ điển.
- `sky.html`: Bầu trời trăng rằm với những chiếc đèn Việt Nam bay lên từng nhịp; chạm vào đèn để mở lời chúc bất ngờ.
- `wishes.html`: Hòm thư lưu giữ những lời chúc ấm áp dạng thẻ thiệp.
- `profile.html`: Trang lưu niệm cá nhân ghi lại ngày ghé thăm, quà đã mở, lời chúc đã gửi và xuất ảnh thiệp PNG.
- `about.html`: Giới thiệu ý nghĩa đêm trăng đoàn viên, trích dẫn thơ, chia sẻ và mã QR.

## Các điểm cải tiến nổi bật

1. **Điều hướng PJAX & Âm thanh xuyên suốt:** Các trang vẫn là file HTML tĩnh độc lập (chuẩn SEO, bookmark được), nhưng khi chuyển trang bằng link nội bộ, script sẽ nạp nội dung mượt mà không reload trình duyệt, giúp nhạc Web Audio tiếp tục ngân vang êm ái.
2. **Mở quà 1 chạm:** Chuyển từ Trang chủ sang trang Quà sẽ tự động kích hoạt hiệu ứng mở hộp quà ngay mà không bắt người dùng click lần 2.
3. **Responsive toàn diện:** Tối ưu mượt mà cho mọi kích thước: Màn hình lớn (Desktop), Laptop ngắn (1366x768), Máy tính bảng (Tablet dọc/ngang 768px), Màn hình gập và Điện thoại di động (Mobile).
4. **Ảnh WebP:** Ảnh nền và 5 mẫu đèn được nén để tải nhanh, kèm PNG dự phòng.
5. **Bộ Icon & Mỹ thuật Á Đông:** Sử dụng hệ thống SVG vector nét mảnh viền vàng hoàng kim (đèn lồng, trăng rằm, phong thư, nốt nhạc) sang trọng, tinh tế.
6. **Xuất ảnh Canvas chống đè chữ:** Thuật toán tính toán chiều cao dòng chữ linh hoạt, căn giữa chuẩn mực và tự động dạt chữ ký xuống vị trí an toàn, không bao giờ bị đè chữ dù lời chúc ngắn hay dài.
7. **Đèn lồng Việt Nam:** Chọn đèn ông sao, cá chép, kéo quân, thỏ ngọc hoặc đèn lụa Hội An khi gửi lời chúc. Bầu trời giữ tối đa 14 đèn đang bay trên máy tính hoặc 8 đèn trên điện thoại và lần lượt đưa tất cả lời chúc công khai trong trình duyệt vào vòng bay. Tên người gửi chỉ hiện khi mở lời chúc.

## Lưu trữ dữ liệu & Bản trải nghiệm

- Phiên bản hiện tại lưu trữ cục bộ trên trình duyệt qua `localStorage` (khóa `moonwish-v1`).
- Mỗi thiết bị có dữ liệu riêng; bản thử nghiệm chưa đồng bộ lời chúc giữa các máy. Muốn mọi người cùng thấy tất cả lời chúc cần kết nối một cơ sở dữ liệu chung.
- Nhạc được tạo trực tiếp bằng Web Audio API (dao động sóng sin nhẹ nhàng), không dùng file âm thanh có bản quyền.
- Mã QR trong `assets/qr.svg` dùng để chia sẻ trang.

## Kế hoạch kết nối Supabase (Giai đoạn nâng cao)

Để mở rộng cho cộng đồng chia sẻ lời chúc thời gian thực:
- Tạo bảng `visitors`, `wishes`, `wish_claims`, `reports`.
- Sử dụng Supabase Anonymous Auth hoặc định danh xác thực, thiết lập RLS (Row Level Security) và RPC giao dịch bốc quà.
