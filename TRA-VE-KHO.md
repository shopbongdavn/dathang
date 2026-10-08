# Trả hàng về kho khi quét mã — nối với bên quét mã

Bên quét mã (`shopbongdavn/quetma`) quét gói hàng trả về. Đường `/tra-ve` của
phần mềm kho cho họ tra ra đơn nào, rồi cộng lại tồn khi được xác nhận.

Khác `/tru-ton` ở một điểm quan trọng: **tìm theo mã vận chuyển** (hoặc mã đơn)
chứ không theo `ma_don` của lệnh trừ — vì người quét chỉ có cái mã in trên gói
hàng trong tay. Nhờ vậy đơn nhập tay trong phần mềm kho cũng trả về được, không
riêng đơn web.

---

## Hai việc, tách đôi có chủ ý

| | Việc | Đụng tồn? |
| --- | --- | --- |
| `GET /tra-ve?ma=<mã>` | Tra cứu: ra mã đơn, mã vận chuyển, SKU | **Không** |
| `POST /tra-ve` | Trả về kho: cộng lại tồn, đánh dấu huỷ lượt xuất | Có |

Tách ra vì quét nhầm một đơn mà cộng tồn ngay thì sai số tồn, mà sai tồn là sai
tiền. Người quét nhìn đúng đơn trên màn hình rồi mới bấm xác nhận.

Dùng chung khoá `TRU_TON_KHOA`, gửi trong header `X-Khoa`.

---

## Bên quét mã nối vào bằng Service binding

Bên quét mã không gọi thẳng từ trình duyệt (làm vậy là đưa khoá kho cho người
lạ) mà đi qua Worker của chính nó. **Worker đó phải nối sang đây bằng Service
binding, không qua địa chỉ `workers.dev`:** Cloudflare chặn một Worker fetch
sang Worker khác cùng vùng `workers.dev` và trả về trang lỗi **1042** — dù mở
đúng địa chỉ đó bằng trình duyệt vẫn bình thường.

Trong `wrangler.jsonc` của Worker quét mã:

```jsonc
"services": [ { "binding": "KHO", "service": "dathang" } ]
```

`service` phải trùng tên Worker này trên Cloudflare, và hai Worker phải cùng
một tài khoản. Khác tài khoản thì mới dùng `KHO_URL` trỏ sang `workers.dev`.

---

## Tra cứu

```
GET /tra-ve?ma=SPXVN060424781919
X-Khoa: <khoá>
```

```json
{ "ok": true, "ma": "SPXVN060424781919",
  "tim_thay": true, "so_dong": 2,
  "ma_don": "586374493940778691",
  "ma_van_chuyen": "SPXVN060424781919",
  "hang": [
    { "sku": "ij-f50mg-t", "size": "40", "so_luong": 2, "da_tra_ve": false },
    { "sku": "abd-020",    "size": "L",  "so_luong": 1, "da_tra_ve": false }
  ],
  "da_tra_ve_het": false, "cach": "chi-muc" }
```

Không tìm thấy thì vẫn `200` với `tim_thay: false` — không phải lỗi, chỉ là kho
không có đơn nào khớp.

`da_tra_ve_het: true` nghĩa là đơn này đã trả về kho rồi (hoặc chủ shop đã huỷ
tay trong phần mềm). Bên quét mã dựa vào đó để **không** mời bấm lại.

## Trả về kho

```
POST /tra-ve
X-Khoa: <khoá>
Content-Type: application/json

{ "ma": "SPXVN060424781919" }
```

Trả về y như tra cứu, kèm:

```json
{ "da_lam": true, "ton_moi": { "ij-f50mg-t": { "40": 5 } }, "da_tra_ve_het": true }
```

**Gọi lại bao nhiêu lần cũng chỉ cộng tồn một lần.** Lượt xuất nào đã đánh dấu
huỷ thì bỏ qua và liệt kê trong `bo_qua`; khi không còn gì để cộng thì
`da_lam: false`, `ly_do: "da_tra_ve_truoc_do"`.

Mỗi lần trả về ghi một dòng vào `tra-ve/<id>` (mã quét, giờ, các lượt xuất đã
đụng) để tra lại sau.

Xếp hàng chung khoá `web_khoa` với `/tru-ton`, nên không có chuyện hai bên cùng
sửa một ô tồn.

---

## Lỗi

| Tình huống | HTTP | `loi` |
| --- | --- | --- |
| Thiếu / sai `X-Khoa` | 401 | `khoa_sai` |
| Thiếu mã, mã quá 80 ký tự, thân không phải JSON | 400 | `thieu_du_lieu` |
| Phương thức khác GET/POST | 405 | `chi_nhan_get_post` |
| Bên kho chưa cài xong | 503 | `chua_cai_dat` |
| Đang xử lý đơn khác quá 6 giây | 503 | `dang_ban` |
| Lỗi bên trong | 500 | `loi_he_thong` |

`GET /tra-ve` không kèm `ma` trả về trạng thái cài đặt, không cần khoá:

```json
{ "ok": true, "san_sang": true, "thieu": [] }
```

---

## Nên khai chỉ mục cho nhanh

Mặc định `/tra-ve` hỏi Firebase theo chỉ mục `track` và `order`. Chưa khai thì
Firebase trả `400`, lúc đó nó **hạ xuống quét toàn bộ nhánh `moves`** (có cache
60 giây, tối đa 20000 lượt) nên vẫn chạy, chỉ là chậm và tốn băng thông. Khi đó
câu trả lời kèm:

```json
"cach": "quet-toan-bo",
"canh_bao": [{ "ly_do": "chua_khai_chi_muc", "cach_sua": "..." }]
```

### Khai thế nào

Firebase Console → chọn project → **Realtime Database** (menu trái, mục *Build*)
→ thẻ **Rules**.

Thêm một dòng `"moves"` **nằm cạnh `"kho"`, bên trong nhánh mã kho** — không
phải ở ngoài cùng. Mọi dữ liệu đều nằm dưới mã kho, đặt sai chỗ thì Firebase
nhận nhưng không có tác dụng gì:

```json
{
  "rules": {
    "kho-ijomi-7q3f9zt2wm": {
      ".read": "auth != null && auth.uid === 'UID_CUA_BAN'",
      ".write": "auth != null && auth.uid === 'UID_CUA_BAN'",
      "kho": {
        ".read": true
      },
      "moves": {
        ".indexOn": ["track", "order"]
      }
    }
  }
}
```

Nhớ **dấu phẩy** sau `}` của khối `"kho"` — thiếu là Firebase báo lỗi cú pháp,
không cho Publish. Bấm **Publish**, có hiệu lực ngay, không cần deploy lại gì.

`.indexOn` **không đụng tới quyền đọc/ghi**. Nó chỉ bảo Firebase lập sẵn chỉ mục
cho hai trường đó, nên không làm kho hở ra cho người lạ.

### Biết đã ăn chưa

Khai xong `cach` đổi từ `"quet-toan-bo"` thành `"chi-muc"` và hết `canh_bao`.
Trên màn hình bên quét mã: dòng *"⚡ Kho đang tra kiểu chậm — Rules của Firebase
chưa khai chỉ mục cho nhánh moves"* tự biến mất ở lần quét sau.

---

## So mã

Khi quét toàn bộ, mã được so sau khi **bỏ hết dấu cách và ký tự không phải chữ
số** rồi viết HOA: `spxvn 060-424781919` khớp `SPXVN060424781919`. Một ô
`track`/`order` chứa nhiều mã ngăn bằng dấu phẩy thì tách ra so từng cái.

Đường chỉ mục thì so **khớp đúng nguyên văn** (Firebase chỉ làm được thế). Hai
cách có thể cho kết quả khác nhau ở những ô có mã ghi khác định dạng — hiếm, và
đường quét toàn bộ luôn là lưới hứng.
