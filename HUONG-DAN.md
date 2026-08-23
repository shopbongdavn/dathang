# Kho & Đặt hàng — hướng dẫn cài đặt

Phần mềm là một trang HTML chạy thẳng trong trình duyệt. Dữ liệu lưu trong máy
(localStorage) để thao tác tức thì, và đồng bộ lên một kho chung để nhiều máy
cùng dùng.

Có hai cách làm kho chung. **Nên dùng Firebase.**

| | Firebase Realtime Database | Google Sheets |
|---|---|---|
| Máy kia thấy sau | dưới 1 giây, tự hiện | 15 giây, phải chờ dò |
| Hai máy gõ cùng lúc | mỗi ô một chỗ riêng, không đè nhau | cả bảng ghi đè một lần, dễ mất |
| Đang gõ mà mất mạng | giữ lại rồi tự gửi | giữ lại rồi tự gửi |
| Xem/sửa thẳng bằng tay | phải vào Firebase Console | mở bảng tính là thấy |

- `web/index.html` — phần mềm
- `apps-script/Code.gs` — chỉ cần khi dùng cách Google Sheets

**Làm phần A (Firebase) rồi phần C (Cloudflare) là xong, khoảng 10 phút.**
Phần B chỉ dành cho ai muốn dùng Google Sheets thay cho Firebase.

---

## A. Firebase làm nơi lưu chung  *(nên dùng)*

### A1. Tạo dự án

1. Vào <https://console.firebase.google.com> → **Add project / Thêm dự án**.
2. Đặt tên, ví dụ `kho-ijomi`. Phần Google Analytics **tắt đi**, không cần.
3. Bấm **Create project** và chờ xong.

### A2. Bật Realtime Database

1. Menu trái → **Build → Realtime Database** → **Create Database**.
2. Chọn vùng gần nhất: **Singapore (asia-southeast1)**.
3. Chọn **Start in locked mode** (khoá hết). Sẽ mở đúng phần mình cần ở bước sau.
4. Xong thì phía trên hiện địa chỉ dạng
   `https://kho-ijomi-default-rtdb.asia-southeast1.firebasedatabase.app`.
   **Copy để dành**, đây là `FIREBASE_URL`.

### A3. Tự nghĩ ra một "mã kho"

Đây là chuỗi bí mật, cũng là tên ngăn chứa dữ liệu. Tự đặt một chuỗi dài, khó
đoán, chỉ gồm chữ thường / số / dấu gạch — ví dụ:

```
kho-ijomi-7q3f9zt2wm
```

**Ai không biết chuỗi này thì không đọc được, không ghi được gì.** Đừng đặt
ngắn kiểu `kho` hay `test`.

### A4. Tạo tài khoản đăng nhập

Đây là bước bắt buộc. Mã kho dài chỉ là **giấu**, không phải **khoá**: ai biết
được chuỗi đó là xoá sạch kho được. Chỉ tài khoản đăng nhập cộng với Rules ở
bước A5 mới thật sự chặn.

1. Menu trái → **Build → Authentication** → **Get started**.
2. Thẻ **Sign-in method** → chọn **Email/Password** → bật **Enable** → **Save**.
   (Chỉ bật dòng trên, dòng *Email link* để tắt.)
3. Thẻ **Users** → **Add user**. Điền email của bạn và một mật khẩu dài,
   ví dụ `chu@ijomi.vn`. Bấm **Add user**.
4. Dòng vừa tạo có cột **User UID** dạng `k3Xh9…`. Rê chuột vào, bấm biểu tượng
   copy. **Đây là `UID` — để dành, lát nữa dán vào Rules.**

Rồi lấy thêm khoá web: bánh răng góc trái → **Project settings → General** →
mục **Web API key** dạng `AIzaSy…`. Copy để dành, đây là `FIREBASE_KEY`.

> Khoá web này vốn công khai, lộ ra cũng không sao — nó chỉ để gọi màn hình
> đăng nhập. Thứ chặn người lạ là Rules, không phải khoá này.

### A5. Đặt Rules

Vào thẻ **Rules** của Realtime Database, xoá hết và dán vào. Nhớ thay **mã kho**
của bạn và thay `UID_CUA_BAN` bằng UID vừa copy ở bước A4:

```json
{
  "rules": {
    "kho-ijomi-7q3f9zt2wm": {
      ".read": "auth != null && auth.uid === 'UID_CUA_BAN'",
      ".write": "auth != null && auth.uid === 'UID_CUA_BAN'",
      "kho": {
        ".read": true
      }
    }
  }
}
```

Bấm **Publish**.

> Không muốn tự sửa tay: cứ đăng nhập trong phần mềm trước (bước A7). Nếu Rules
> chưa khớp, phần mềm sẽ hiện khung đỏ kèm **đoạn Rules đã điền sẵn mã kho và
> UID của bạn** và nút *Copy đoạn Rules này* — copy rồi dán thẳng vào Firebase.

Nghĩa của mấy dòng này:

- Cả nhánh kho hàng: **chỉ mình bạn** (tài khoản ở bước A4) đọc và ghi được.
- Riêng nhánh con `kho` — chỉ có mã hàng và số tồn — thì **ai đọc cũng được**,
  để trang shopbongda lấy số tồn hiện lên cho khách. Đọc thôi, **ghi vẫn cấm**.

### A6. Khai báo trên Cloudflare — làm một lần, mọi máy dùng được

Vào Cloudflare → dự án `dathang` → **Settings → Variables and Secrets**, thêm
ba mục, cả ba để kiểu **Secret**:

| Tên | Giá trị |
|---|---|
| `FIREBASE_URL` | địa chỉ ở bước A2 |
| `FIREBASE_MA` | mã kho ở bước A3 |
| `FIREBASE_KEY` | khoá web ở bước A4 |

Rồi **Deploy** lại. Từ đó mở địa chỉ trang trên bất kỳ máy nào cũng tự nối,
không phải nhập gì.

> Cloudflare có thể gợi ý "Update your wrangler config file with these
> changes" — **bỏ qua**, làm theo là mã kho lọt vào GitHub.

### A7. Đăng nhập trên từng máy

Mở trang → **Cài đặt** → khung **Đăng nhập Firebase** → điền email và mật khẩu
ở bước A4 → **Đăng nhập**. Mỗi máy làm một lần, sau đó máy nhớ luôn, đóng mở
trình duyệt hay tắt máy vẫn còn.

Chưa đăng nhập thì trên đầu trang báo *"Chưa đăng nhập Firebase — vào Cài đặt
đăng nhập"* và không lưu lên Firebase được (số gõ vẫn nằm trong máy, đăng nhập
xong là tự gửi lên).

### A8. Đưa dữ liệu đang có lên

Mở trang bằng chính cái máy đang giữ dữ liệu đầy đủ nhất:

- Firebase còn trống → phần mềm **tự đưa dữ liệu máy đó lên** làm gốc, xong.
- Muốn ép ghi đè → **Cài đặt → Đưa dữ liệu máy này lên Firebase**.

Sau đó mở trên điện thoại, máy khác — số liệu hiện y hệt trong khoảng một giây.

### A9. Kiểm tra nhanh

1. Mở trang trên máy tính và trên điện thoại (cả hai đã đăng nhập ở bước A7).
2. Điện thoại: vào tab **Đặt hàng**, gõ một số bất kỳ.
3. Máy tính **không bấm gì cả** — trong khoảng một giây con số đó phải hiện ra.

Nếu chữ trên đầu trang báo `Lỗi đồng bộ`, xem lại: địa chỉ có đúng không, mã
kho trong Rules có trùng với `FIREBASE_MA` không, máy đã đăng nhập chưa.

### A10. Kiểm tra Rules đã siết thật chưa

**Cách dễ:** trong phần mềm, vào **Cài đặt** → khối *Đồng bộ Firebase* → bấm
**Kiểm tra khoá kho**. Phần mềm tự thử đúng ba việc mà người lạ sẽ làm rồi
trả lời bằng tiếng Việt. Phải ra đủ ba dấu ✓:

```
Kho đã khoá đúng.
✓ shopbongda đọc được số tồn
✓ đơn hàng, nhật ký: người lạ không đọc được
✓ người lạ không ghi được
```

Ra chữ *"Còn chỗ hở"* thì đọc dòng ✗ để biết hở chỗ nào, rồi quay lại bước A5.

**Cách thủ công** (muốn tự tay kiểm chứng): mở Terminal (máy Mac) hoặc
PowerShell (Windows), thay hai dòng đầu bằng của bạn rồi chạy từng lệnh. Con số
in ra phải đúng như ghi bên cạnh:

```bash
FU=https://kho-ijomi-default-rtdb.asia-southeast1.firebasedatabase.app
MA=kho-ijomi-7q3f9zt2wm

curl -s -o /dev/null -w "%{http_code}\n" "$FU/$MA/kho.json?shallow=true"   # 200
curl -s -o /dev/null -w "%{http_code}\n" "$FU/$MA/mh.json?shallow=true"    # 401
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH -d '{"thu":1}' \
     "$FU/$MA/kho.json"                                                    # 401
```

- Dòng 1 phải **200**: shopbongda lấy được số tồn.
- Dòng 2 phải **401**: người lạ không đọc được đơn hàng, nhật ký, ghi chú.
- Dòng 3 phải **401**: người lạ **không xoá được kho**.

Ra `200` ở dòng 2 hoặc dòng 3 là Rules chưa siết — quay lại bước A5.

---

## B. Google Sheets làm nơi lưu chung  *(cách cũ, chỉ dùng khi không muốn Firebase)*

### B1. Tạo file Sheets

Mở [sheet.new](https://sheet.new), đặt tên ví dụ `Kho Ijomi`. Không cần tạo cột
gì cả — phần mềm tự tạo 4 tab khi lưu lần đầu.

### B2. Dán code

Trong file Sheets vừa tạo: **Tiện ích mở rộng → Apps Script**
(Extensions → Apps Script).

Xoá hết code mẫu trong ô soạn thảo, dán toàn bộ nội dung file
`apps-script/Code.gs` vào.

### B3. Đổi mã bảo vệ

Sửa dòng đầu:

```js
var TOKEN = 'doi-ma-nay-di-1234';
```

Đổi thành một chuỗi của riêng bạn, khó đoán, ví dụ `ijomi-kho-x7k2mq9`.
Ghi lại chuỗi này, lát nữa phải điền vào phần mềm y hệt.

Dòng `SHEET_ID` để trống vì script nằm ngay trong file Sheets.

Bấm biểu tượng đĩa mềm để lưu.

### B4. Triển khai

**Triển khai → Tuỳ chọn triển khai mới** (Deploy → New deployment).

- Bấm bánh răng cạnh "Chọn loại", chọn **Ứng dụng web** (Web app)
- Thực thi với tư cách: **Tôi** (Me)
- Ai có quyền truy cập: **Bất kỳ ai** (Anyone)
- Bấm **Triển khai**

Lần đầu Google sẽ hỏi quyền: chọn tài khoản → màn hình cảnh báo hiện ra thì bấm
**Nâng cao** → **Đi tới … (không an toàn)** → **Cho phép**. Cảnh báo này là bình
thường với script tự viết.

Xong, copy **URL ứng dụng web**, dạng:

```
https://script.google.com/macros/s/AKfycb..................../exec
```

> **Về bảo mật.** "Bất kỳ ai" nghĩa là ai biết URL cũng gọi được, nên mã bảo vệ
> ở bước B3 là thứ duy nhất chặn người lạ. Đặt chuỗi khó đoán và đừng đăng URL
> đó lên chỗ công khai. Không cần chọn "Bất kỳ ai" mức thấp hơn — mức có yêu cầu
> đăng nhập Google sẽ chặn luôn cả phần mềm.

### B5. Nối phần mềm với Sheets

Mở phần mềm, kéo xuống mục **Cài đặt & sao lưu → Đồng bộ Google Sheets**:

- **Địa chỉ ứng dụng web**: dán URL vừa copy
- **Mã bảo vệ**: chuỗi đã đặt ở bước B3

Bấm **Đưa dữ liệu máy này lên Sheets**. Quay lại file Sheets sẽ thấy 4 tab:

| Tab | Nội dung |
|---|---|
| `Kho` | Nhóm, SKU, Tên, rồi mỗi size một cột. Ô ghi `N` là hàng bị khoá |
| `NhatKy` | Từng lượt xuất/nhập, kèm mã vận đơn và trạng thái huỷ |
| `Anh` | Ảnh sản phẩm |
| `CaiDat` | Ngưỡng cảnh báo và số phiên bản |

Từ đó mỗi lần mở trang nó tự tải về, và mỗi thay đổi tự lưu lên sau khoảng 2 giây.

### B6. Khai báo cấu hình trên Cloudflare

Đây là bước quan trọng nhất để **mở địa chỉ ở bất kỳ máy nào cũng có sẵn dữ liệu**,
không phải nhập gì. Worker sẽ tự phát cấu hình cho trang qua `/config.json`.

Vào Cloudflare → Worker `dathang` → **Settings** → **Variables and Secrets** →
**Add**, thêm hai mục, **cả hai đều chọn kiểu Secret**:

| Tên | Giá trị |
|---|---|
| `SHEETS_URL` | địa chỉ `/exec` lấy ở bước B4 |
| `SHEETS_TOKEN` | mã bảo vệ đã đặt ở bước B3 |

> **Phải chọn Secret, đừng chọn Text.** Biến kiểu Text chỉ khai trong bảng điều
> khiển sẽ bị xoá mất ở lần `wrangler deploy` sau, vì nó không có trong
> `wrangler.toml`. Secret thì được giữ nguyên.

Lưu xong Cloudflare tự dựng lại. Mở địa chỉ `.workers.dev` ở bất kỳ máy nào —
điện thoại, máy khác, cửa sổ ẩn danh — là thấy ngay dữ liệu chung, chip góc phải
hiện *Đã đồng bộ*.

Khi nào chưa khai hai biến này, trang sẽ báo *"Máy chủ chưa có biến SHEETS_URL và
SHEETS_TOKEN"*. Lúc đó vẫn dán tay vào hai ô trong mục Cài đặt được, hoặc dùng nút
**Tạo link cài sẵn cho máy khác** để gửi cấu hình sang máy kia.

---

## C. Đưa phần mềm lên Cloudflare

### C1. Tạo dự án

Vào [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
**Create** → thẻ **Pages** → **Connect to Git**.

Cho phép Cloudflare truy cập GitHub, chọn kho `shopbongdavn/troly_01`.

### C2. Cấu hình

Cloudflare hiện đưa "Connect to Git" vào **Workers**, không phải Pages. Hai loại
dự án điền khác nhau — xem trên trang dự án của bạn có ô nào thì điền theo cột đó:

**Nếu là Workers** (có các tab Bindings, Observability, và ô *Deploy command*):

| Mục | Điền |
|---|---|
| Build command | **để trống** |
| Deploy command | `npx wrangler deploy` |

File `wrangler.toml` ở gốc kho đã khai báo sẵn thư mục `web`, không cần điền
thư mục ở đâu nữa. **Kiểm tra dòng `name` trong `wrangler.toml` có trùng tên dự
án trên Cloudflare không** — không trùng thì Cloudflare sẽ tạo thêm một dự án
thứ hai với địa chỉ khác.

**Nếu là Pages** (có ô *Build output directory*):

| Mục | Điền |
|---|---|
| Framework preset | None |
| Build command | **để trống** |
| Build output directory | `web` |

Đừng điền `web` vào ô *Deploy command* — Cloudflare sẽ chạy nó như một câu lệnh
và báo `/bin/sh: 1: web: not found`.

Bấm lưu và triển khai. Khoảng một phút sau được địa chỉ dạng
`dathang.<tên tài khoản>.workers.dev`. Mỗi lần đẩy code mới lên
GitHub, Cloudflare tự dựng lại.

### C3. Kiểm tra

Mở địa chỉ vừa nhận trên điện thoại, điền địa chỉ Sheets và mã bảo vệ,
bấm **Tải từ Sheets về máy**. Phải thấy đúng số liệu như trên máy tính.

---

## Những điều cần biết khi dùng

**Chỉ bản trên Cloudflare Pages mới đồng bộ được.** Bản xem trên link artifact
của Claude bị chặn gọi ra mạng ngoài, nên ở đó phần mềm chỉ lưu trong máy.

**Khi hai máy sửa cùng lúc.** Mỗi lần lưu lên, số phiên bản trên Sheets tăng
một. Nếu máy bạn đang giữ số cũ, phần mềm **không ghi đè** mà hiện băng vàng hỏi
giữ bên nào:

- *Lấy bản trên Sheets* — bỏ thay đổi chưa lưu ở máy này
- *Ghi đè Sheets* — lấy dữ liệu máy này làm chuẩn, thay đổi của máy kia mất

Máy đang mở sẵn sẽ **tự tải bản mới** mỗi khi bạn quay lại tab đó, nên thường
không phải làm gì. Chỉ khi đang gõ dở số lượng đặt hàng hoặc đang xem bảng đối
chiếu PDF thì nó dừng lại hỏi, để khỏi cuốn mất việc đang làm.

**Sửa thẳng trong Google Sheets được**, nhưng phải làm lúc không máy nào đang mở
phần mềm, rồi bấm *Tải từ Sheets về máy*. Đừng thêm/bớt cột ở tab `Kho` — muốn
đổi dải size thì sửa trong phần mềm rồi để nó ghi lên.

**Ảnh sản phẩm.** Khung ảnh để vuông 1:1 cho khớp ảnh trên sàn. Bấm vào ô ảnh, dán link (chuột phải vào ảnh trên TikTok Shop →
"Sao chép địa chỉ ảnh") hoặc chọn file từ máy. Cả hai cách đều **tải ảnh về, thu
nhỏ còn khoảng 1–2 KB rồi lưu hẳn vào dữ liệu**, nên nguồn có hết hạn hay đổi thì
ảnh vẫn còn. Link ảnh của các sàn thường có chữ ký hết hạn sau vài giờ — lưu
nguyên link thì hôm sau ảnh biến mất, nên phần mềm không làm vậy.

Việc tải hộ đi qua đường `/img` của Worker, vì trình duyệt không lấy trực tiếp
được ảnh từ CDN của sàn. Chạy ngoài Cloudflare (mở file rời) thì không tải hộ
được, lúc đó phần mềm báo rõ và tạm giữ link.

**Chia tab.** Màn hình chia năm tab: Kho hàng, Xuất hàng, Huỷ đơn, Nhật ký, Cài
đặt. Tab đang mở được nhớ lại cho lần sau. Tab Kho hàng có ô tìm kiếm theo mã SKU,
tên màu hoặc nhóm hàng — cần khi danh sách dài ra.

**Nạp file Excel / CSV.** Phiếu Shopee in ra không có mã SKU, nên dùng file đơn
hàng xuất từ Sapo (hoặc bất kỳ nơi nào) thay cho phiếu PDF. Kéo file `.xlsx` hay
`.csv` vào đúng ô đó.

Phần mềm tự đoán cột nào là mã SKU, size, số lượng, mã vận đơn, mã đơn hàng — rồi
cho xem thử 3 dòng đầu để đối chiếu trước khi dùng. Đoán sai thì chọn lại bằng tay,
lần sau file cùng kiểu tiêu đề sẽ nhớ lựa chọn đó.

Nếu mã SKU trong file đã kèm size ở đuôi (`ij-f50mg-t-40`) thì để ô *Cột size* ở
mục "SKU đã kèm size". Nếu size nằm ở cột riêng thì chọn cột đó.

**Nên chọn cột mã vận đơn hoặc mã đơn hàng.** Không có thì lần sau nạp lại phần mềm
không biết đơn nào đã trừ, và sẽ trừ lại lần nữa.

Với file Sapo thì phần mềm đã tự làm đúng: bỏ qua dòng tên báo cáo ở trên cùng, lấy
tiêu đề ở dòng 2, chọn cột `SKU`, `Số lượng`, `Mã đơn trên Sapo` và `Trạng thái trên
Sàn`. Cột `Mã vận đơn` của Sapo thường để trống nên phần mềm tự bỏ qua, và cột `Vận
chuyển` (tên hãng ship) cũng không bị nhầm là mã vận đơn.

**Lọc theo trạng thái.** Nếu có chọn *Cột trạng thái*, những dòng ghi huỷ / hoàn /
trả hàng sẽ bị bỏ qua, không trừ kho. Khung chọn cột báo rõ bỏ bao nhiêu dòng.

**Mã chưa có trong kho.** Bảng đối chiếu ghi *Chưa có SKU này* cho mã lạ. Những dòng
này **không tính vào nút trừ kho** — trừ một mã không tồn tại thì cũng chẳng trừ được
gì, nên phần mềm tách riêng và nói rõ bỏ bao nhiêu đôi.

Bấm nút **+ Thêm N mã chưa có vào kho** là tạo hết một lượt, hỏi tên nhóm rồi thêm với
tồn 0. Sau đó vào *Sửa tồn thực tế* nhập số rồi nạp lại file — không phải gõ tay từng
dòng.

**Danh sách dài.** Trong bảng tồn kho, cứ 8 dòng lại chèn thêm một hàng ghi số size,
nên cuộn tới đâu cũng biết cột nào là size nào, khỏi kéo ngược lên đầu bảng.

**Dùng trên điện thoại.** Ô nhập để cỡ chữ 16px trở lên vì dưới mức đó Safari và
Chrome trên điện thoại tự phóng to trang mỗi lần bấm vào ô. Ô cao 46px cho dễ bấm,
và bật bàn phím số thay vì bàn phím chữ.

Đang gõ ở dòng nào thì cả dòng đó sáng lên kèm vạch xanh bên trái. Ô đã điền số đặt
cũng tô xanh.

Riêng chế độ **Đặt hàng trên điện thoại**, phần mềm giấu cột tên và mã SKU để nhường
chỗ — nhờ vậy **hiện hết dải size trên một màn, không phải kéo ngang**. Ảnh sản phẩm
vẫn giữ để nhận ra mã, tên nhóm chuyển thành dải riêng phía trên bảng. Xoay ngang máy
hoặc mở trên máy tính thì cột tên hiện lại như cũ.

**Đặt hàng.** Ở chế độ *Đặt hàng*, cột cuối đổi tiêu đề thành **Tổng** và cộng ngang
số vừa gõ của từng dòng; tên nhóm hiện thêm "· đặt N". Chân bảng có ba nút:

- **Chỉ hiện mã đang đặt** — ẩn hết mã và nhóm không đặt, để soát lại cho gọn
- **📷 Chụp phiếu đặt hàng** — vẽ ra ảnh PNG, tải về máy và copy luôn vào bộ nhớ tạm
  nên dán thẳng vào Zalo được. Ảnh có **ảnh sản phẩm**, tên phiên bản, mã SKU, chỉ lấy
  những size thật sự có đặt nên gọn, kèm tổng theo từng nhóm và tổng cộng cuối phiếu.
  Ảnh nào còn là link chưa tải về thì phiếu lấy hộ qua đường `/img` để vẽ được.
  Phiếu kẻ ô rõ ràng, **chỉ hiện size nào thật sự có đặt** nên không thừa cột trống;
  cột sản phẩm cũng tự co vừa đúng chữ. Mỗi ô ghi lại số size của chính nó, ô có đặt
  tô xanh đậm chữ trắng, ô không đặt để size xám nhạt. Dòng chẵn lẻ khác nền và mỗi
  nhóm có dải đen riêng, nhìn là tách được từng dòng.
- **Xác nhận đặt hàng** — cộng số đã gõ vào tồn và ghi nhật ký

Số đang gõ ở tab Đặt hàng **cũng được đồng bộ**, nên gõ ở điện thoại lúc đi kiểm kho
rồi mở máy tính là thấy nguyên, in phiếu ở đâu cũng được. Trong Google Sheets nó nằm
ở tab `CaiDat`, dòng khoá `dathang`.

**Nhóm hàng.** Nhóm chưa có mã nào vẫn được giữ khi đồng bộ — trong tab `Kho` nó nằm
ở một dòng chỉ có tên nhóm, cột SKU để trống. Đừng xoá dòng đó trong Google Sheets,
xoá là mất nhóm.

Mỗi nhóm có ba nút ngay cạnh tên: **+ mã** thêm mã vào đúng nhóm đó,
**✎** đổi tên nhóm, **✕** xoá nhóm (chỉ xoá được khi nhóm không còn mã nào). Nhóm mới
tạo vẫn hiện dù chưa có mã.

**Nạp trùng file.** Phần mềm nhớ mã vận đơn của từng lượt đã trừ. Nạp lại file cũ,
hoặc nạp file gộp có lẫn đơn hôm trước, thì các đơn đó hiện *Đã trừ rồi* kèm ngày
giờ đã trừ và **không bị trừ lần hai**. Cứ nạp cả file, không phải lọc tay.

Riêng đơn đã bấm huỷ thì nạp lại vẫn trừ được, vì hàng đã hoàn về kho rồi.

**Tồn âm.** Khi nạp PDF, ô *Trừ cả dòng không đủ tồn* đã tick sẵn, nên đơn nào
cũng trừ được kể cả khi bảng chưa kịp cập nhật. Ô nào âm sẽ tô đỏ nhạt — đó là
dấu hiệu cần kiểm lại kho, không phải lỗi.

**Vẫn nên tải file sao lưu** định kỳ ở mục Cài đặt. Sheets có lịch sử sửa đổi,
nhưng file `.json` khôi phục nhanh hơn nhiều.

**Phiên bản.** Số `v2.9` cạnh tên phần mềm là bản đang chạy. Khi Cloudflare dựng
xong bản mới, trang đang mở sẽ hiện băng xanh *"Đã có bản mới"* kèm nút tải lại —
kiểm mỗi phút một lần và mỗi khi quay lại tab. Bấm *Để sau* thì băng ẩn đi cho
đến lần mở trang sau.

Khi sửa code, số phiên bản phải đổi ở **cả hai chỗ**: hằng `APP_VER` trong
`web/index.html` và `web/version.json`. Chạy `node tools/check-version.js` để kiểm
trước khi đẩy lên — lệch nhau thì trang sẽ báo có bản mới mãi không hết.

**Mất mạng vẫn dùng được.** Phần mềm chạy trên dữ liệu trong máy, chỉ phần lưu
lên Sheets là báo lỗi. Có mạng lại thì bấm *Đưa dữ liệu máy này lên Sheets*.
