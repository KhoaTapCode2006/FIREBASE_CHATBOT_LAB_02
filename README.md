# BamBooChatBot — Hệ thống Chat AI 
___
# THÔNG TIN SINH VIÊN
Tên: Trần Nguyễn Anh Khoa  

MSSV: 24120075  

Lớp: 24CTT3  

Giảng viên hướng dẫn thực hành: Lê Đức Khoan  
___
## Mô tả
- BamBooChatBot là ứng dụng mẫu tích hợp frontend tĩnh với backend FastAPI sử dụng mô hình sinh văn bản Deepseek R1.
- Website sỡ hữu tính năng đăng nhập/đăng ký và xác thực người dùng bằng Firebase Auth và lưu lịch sử chat vào Firestore.
- Website là mô hình Chatbot AI thông minh cùng khả năng lưu lại các câu hỏi và câu trả lời
___
## Tính năng chính
- Đăng nhập, đăng ký và xác thực bằng Email, Google
- Sinh văn bản bằng mô hình AI Deepseek R1
- Quản lý session người dùng (tạo / đổi tên / xóa)
- Frontend giao tiếp với Backend thông qua POST /chat
- Lưu trữ các session và thông tin các câu chat với AI cho từng người dùng
___
## Yêu cầu
- Python 3.10+
- Kết nối Internet để tải model AI từ Huggingface 
- Tài khoản, project Firebase và Service Account JSON để dùng Admin SDK
- Các thư viện cần thiết (Được liệt kê trong requirements.txt)
___
## Cấu trúc dự án
```text
.
├── backend/
│   ├── firebase_client.py      # File lấy Service Account JSON từ .env được cài đặt bởi dev
│   └── main.py                 # File chứa model AI và tất cả các tính năng của Backend
├── frontend/
|   ├── app.js                  # File chứa configuration của Firebase, endpoin Backend và các hàm xử lý chức năng của Frontend
|   ├── homepage.html           # Trang chủ chứa giao diện, tính năng chính và thực hiện sinh văn bản thông qua giao tiếp với Backend
|   ├── login.html              # Trang dùng để đăng nhập bằng Email hoặc Google
|   ├── signup.html             # Trang dùng để đăng ký bằng Email hoặc Google
|   └── index.html              # Trang điều hướng người dùng tới homepage hoặc login (Nếu chưa có trạng thái đăng nhập)
├── requirements.txt            # File requirements chứa các thư viện cần thiết
└── README.md                   # Markdown giới thiệu và hướng dẫn cách chạy
```
___
## Cách tạo môi trường, cấu hình Firebase và cài đặt thư viện
Bước 1. Tạo project Firebase, bật Authentication (Email, Google) và Firestore (Để ở test mode nếu muốn thay đổi).
Bước 2. Ở project Firebase, vào Settings -> General -> Add App (Website)
Bước 3. Copy Configuration của app vừa tạo và dán vào biến const firebaseConfig trong app.js
```python
const firebaseConfig = {
  apiKey: "yourapikey",
  authDomain: "yourauthdomain.firebaseapp.com",
  projectId: "yourappid",
  storageBucket: "yourstoragebucket.firebasestorage.app",
  messagingSenderId: "yourmessagingsenderid",
  appId: "yourappid",
  measurementId: "yourmeasurementid"
};
```
Bước 4. Vào Settings của project, sau đó vào mục Service Account -> Generate new private key
Bước 5. Tạo file .env với nội dung sau và đưa đường link chứa private key mới tạo vào FIREBASE_CREDENTIALS_PATH:
```env
FIREBASE_CREDENTIALS_PATH=path/to/your/ServiceAccountJSON/serviceAccount.JSON
FIREBASE_PROJECT_ID=your_firebase_project_id
BACKEND_URL=http://127.0.0.1:8000
```
Hoặc sử dụng lệnh để copy content từ file Service Account và không cần lưu file sau khi thiết lập xong
```powershell
$env:FIREBASE_CREDENTIALS_JSON = Get-Content 'path/to/your/ServiceAccountJSON/serviceAccount.JSON' -Raw
```

Bước 6. Vào Authentication -> Settings -> Authorized Domains -> Thêm '127.0.0.1' vào domain
Bước 7. Vào terminal và gõ lệnh này để tải các thư viện cần thiết về: 
```
pip install -r requirements.txt
```
___
## Hướng dẫn chạy chương trình 
```powershell
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```
- Server sẽ được mở với link http://127.0.0.1:8000 và không cần mở server bên phía Frontend
- Sau đó sẽ được điều hướng sang trang dùng để đăng nhập (Nếu chưa có tài khoản hoặc chưa có trạng thái đăng nhập)
- Sau khi đăng nhập/đăng ký thì có thể sử dụng chatbot bình thường
- Có thể logout ra bất cứ khi nào
___
## Sửa lỗi nếu có vấn đề
- Lỗi Firebase: kiểm tra `FIREBASE_CREDENTIALS_PATH` và quyền Firestore.
- Lỗi khi tải model: kiểm tra kết nối mạng 
- OOM / thiếu RAM: giảm `max_length`, hoặc dùng model nhỏ hơn.
- CORS: đảm bảo `frontend` gọi đúng `BACKEND_URL` (mặc định http://127.0.0.1:8000) và backend đã bật CORS.
