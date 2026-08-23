# Lấy tồn kho Ijomi — hướng dẫn cho bên shopbongda

Phần mềm kho (`dathang`) đẩy tồn lên Firebase Realtime Database. Nhánh `kho`
được mở **đọc công khai** để trang shopbongda lấy về hiển thị. Mọi nhánh khác
(đơn hàng, nhật ký, ghi chú) và mọi lệnh ghi đều bị Rules chặn.

Không cần API key, không cần token, không phải đăng ký gì. Chỉ `GET`.

---

## 1. Địa chỉ

```
<FIREBASE_URL>/<MÃ_KHO>/kho.json
```

Hai giá trị này chủ shop gửi riêng (không nằm trong kho code). Dạng:

```
https://<tên-dự-án>-default-rtdb.asia-southeast1.firebasedatabase.app
<mã kho: một chuỗi dài, ví dụ kho-abcd-1234567890ab>
```

Vài cách gọi hay dùng:

| Việc | Đường dẫn |
|---|---|
| Lấy toàn bộ tồn | `/<MÃ_KHO>/kho.json` |
| Lấy một mã hàng | `/<MÃ_KHO>/kho/<sku>.json` |
| Chỉ lấy danh sách mã | `/<MÃ_KHO>/kho.json?shallow=true` |

Trả về CORS mở (`access-control-allow-origin: *`) nên gọi thẳng từ trình duyệt
cũng được.

---

## 2. Dữ liệu trả về

Hai tầng: **mã SKU → size → số tồn**.

```json
{
  "ij-f50mg-t":  { "38": 6, "39": 5, "40": 3, "41": 5, "42": 5, "43": 4, "44": 5 },
  "ij-f50mg-c":  { "38": 2, "39": 3, "40": 5, "41": 5, "42": 5, "43": 3, "44": 2 },
  "ij-f50tf-t":  { "38": 4, "39": 6, "40": 4, "41": 3, "42": 4, "43": 4, "44": 3 },
  "abd-020":     { "S": 4, "M": 7, "L": 6, "XL": 3, "XXL": 0 }
}
```

**Khoá SKU** viết thường, là mã in trên phiếu giao hàng. Đây là khoá chính nối
hai bên — chủ shop cam kết không đổi tên mã đã có. Mã mới xuất hiện thì cứ tự
động nhận thêm.

**Khoá size**: giày là số (`36`…`46`), áo quần là chữ (`S`, `M`, `L`, `XL`,
`XXL`…). Mỗi nhóm hàng một dải size khác nhau, đừng giả định cố định.

### Giá trị ô — có hai dạng

| Giá trị | Nghĩa | Bán được? |
|---|---|---|
| `5` (số) | còn 5 đôi | có |
| `0` | hết | không |
| `"N12"` (chuỗi) | ô bị khoá đặt thêm, **thực tế còn 12** | có, còn 12 |
| `"N"` (chuỗi) | ô bị khoá và không còn hàng | không |

Chữ `N` chỉ nói *"không đặt thêm hàng về nữa"* — chuyện nội bộ kho, không liên
quan tới việc bán. **Cứ bỏ chữ `N` đi, phần còn lại là số tồn thật.**

```js
function tonThat(v){
  if(typeof v === "number") return v;
  const s = String(v || "").trim().toUpperCase();
  if(s.charAt(0) === "N") return parseInt(s.slice(1), 10) || 0;
  return parseInt(s, 10) || 0;
}
```

Thiếu hẳn một size trong JSON nghĩa là size đó không có trong dải hàng — coi
như hết, đừng coi là lỗi.

---

## 3. Cách lấy về

### Cách 1 — gọi định kỳ (đơn giản, đủ dùng)

Tồn chỉ đổi khi kho xuất hàng, ngày vài lần. Gọi lại mỗi **60 giây** là thừa sức.
Nên gọi ở phía máy chủ rồi cache lại, đừng để mỗi khách vào trang là một lượt gọi.

```php
$json = file_get_contents($FIREBASE_URL . '/' . $MA_KHO . '/kho.json');
$kho  = json_decode($json, true);
$ton  = tonThat($kho['ij-f50mg-t']['42'] ?? 0);
```

### Cách 2 — nghe đẩy về (hiện ngay trong một giây)

Cùng địa chỉ đó, thêm header `Accept: text/event-stream`. Firebase giữ kết nối
và đẩy về mỗi khi có thay đổi:

```
event: put
data: {"path":"/","data":{ ...toàn bộ nhánh kho... }}

event: patch
data: {"path":"/ij-f50mg-t","data":{"42":4}}
```

- `put` với `path: "/"` là bản đầy đủ, ghi đè hết.
- `put`/`patch` với `path` cụ thể là sửa đúng nhánh đó; `patch` chỉ ghi đè các
  khoá có trong `data`, khoá khác giữ nguyên.
- `data: null` nghĩa là nhánh đó bị xoá.
- Thỉnh thoảng có `event: keep-alive`, bỏ qua.

Kết nối rớt thì nối lại và lấy lại toàn bộ, đừng cộng dồn từ bản cũ.

---

## 4. Vài điều nên nhớ

**Gọi hỏng thì giữ số cũ, đừng hiện "hết hàng".** Mạng lỗi, Firebase chậm hay
JSON rỗng đều không có nghĩa là hết hàng. Giữ số lần lấy được gần nhất và ghi
log; hiện sai thành hết hàng là mất đơn thật.

**Chỉ đọc.** Mọi lệnh `PUT`/`PATCH`/`POST`/`DELETE` sẽ nhận `401`, kể cả vào
nhánh `kho`. Muốn sửa tồn thì sửa trong phần mềm kho.

**Đừng đọc nhánh khác.** `/<MÃ_KHO>.json`, `/<MÃ_KHO>/mh.json`,
`/<MÃ_KHO>/moves.json`… đều trả `401` — đó là dữ liệu riêng, không phải lỗi.

**Không có tên sản phẩm trong nhánh này**, chỉ có mã và số. Bảng tên sản phẩm,
ảnh, giá do bên shopbongda tự giữ, nối với nhau bằng mã SKU.

**Nhận `401` ở chính `/kho.json`** nghĩa là Rules vừa bị sửa hoặc gõ sai đường
dẫn — báo lại chủ shop, đừng tự đoán.

---

## 5. Thử nhanh trước khi viết code

```bash
FU=<FIREBASE_URL>
MA=<MÃ_KHO>

curl -s "$FU/$MA/kho.json?shallow=true"     # danh sách mã, phải ra JSON
curl -s "$FU/$MA/kho.json" | head -c 400    # tồn thật
curl -s -o /dev/null -w "%{http_code}\n" "$FU/$MA/mh.json"   # phải là 401
```
