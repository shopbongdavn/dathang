# Trừ tồn khi có đơn web — trả lời bên shopbongda

Trả lời tài liệu *"Trừ tồn khi có đơn: shopbongda → Ijomi"*. Đã làm đúng theo
đề nghị bên đó, kèm vài chi tiết nói rõ dưới đây.

---

## Bốn thứ bên shopbongda cần

| # | Thứ | Trả lời |
|---|---|---|
| 1 | Đường dẫn đầy đủ | `https://<địa chỉ phần mềm kho>/tru-ton` — chủ shop chép đúng từ **Cài đặt → Đơn từ web** |
| 2 | Khoá `X-Khoa` | chủ shop gửi riêng, **không** nằm trong tài liệu này |
| 3 | Chống trùng theo `ma_don` | **Có.** Khoá là `ma_don` + `viec`, trừ và ghi dấu trong cùng một lần ghi |
| 4 | Tồn không đủ | **Trừ đủ, cho xuống âm**, trả kèm `canh_bao` |

---

## Gọi thế nào

Y hệt tài liệu bên đó đề nghị:

```
POST https://<địa chỉ phần mềm kho>/tru-ton
Content-Type: application/json
X-Khoa: <khoá>

{ "ma_don": "LP41736744", "viec": "tru",
  "hang": [ { "sku": "ij-alpha3-xn", "size": "40", "so_luong": 1 } ] }
```

`viec` là `"tru"` hoặc `"hoan"`. `so_luong` luôn là số nguyên dương.

Muốn biết đường đã bật chưa thì `GET` cùng địa chỉ, không cần khoá:

```json
{ "ok": true, "san_sang": true, "thieu": [] }
```

`san_sang: false` nghĩa là bên kho chưa cài xong — `thieu` liệt kê tên biến còn
thiếu (chỉ tên, không bao giờ có giá trị).

---

## Trả về

**Trừ / hoàn xong**

```json
{ "ok": true, "ma_don": "LP41736744", "da_lam": true,
  "ton_moi": { "ij-alpha3-xn": { "40": 4 } } }
```

`ton_moi` là số sau khi làm, luôn là **số** — kể cả khi ô đang khoá `"N12"` thì
vẫn trả `11`, còn trong kho vẫn giữ nguyên chữ N (`"N11"`).

**Gọi lại đơn đã làm** — vẫn `200`, không làm lần nữa:

```json
{ "ok": true, "ma_don": "LP41736744", "da_lam": false,
  "ly_do": "da_lam_truoc_do", "luc": "2026-09-26T03:12:09.114Z",
  "ton_moi": { "ij-alpha3-xn": { "40": 4 } } }
```

`ton_moi` ở đây là số lúc làm lần đầu, không phải số hiện tại.

**Tồn không đủ** — vẫn trừ, xuống âm:

```json
{ "ok": true, "ma_don": "LP80000000", "da_lam": true,
  "ton_moi": { "ij-alpha3-xn": { "42": -2 } },
  "canh_bao": [ { "sku": "ij-alpha3-xn", "size": "42", "truoc": 1, "mua": 3 } ] }
```

---

## Lỗi

Sai một dòng là không trừ dòng nào.

| Tình huống | HTTP | `loi` | Gọi lại? |
|---|---|---|---|
| Thiếu / sai `X-Khoa` | 401 | `khoa_sai` | không — sửa khoá |
| Thân không phải JSON, thiếu `ma_don`, `hang` rỗng, `so_luong` không phải số nguyên dương, `viec` lạ | 400 | `thieu_du_lieu` | không — sửa dữ liệu |
| `sku` không có bên kho | 409 | `sku_khong_co` | không — báo chủ shop |
| `size` ngoài dải của mã đó | 409 | `size_khong_co` | không — báo chủ shop |
| Hoàn đơn chưa từng trừ | 409 | `chua_tru` | không |
| Bên kho chưa cài xong | 503 | `chua_cai_dat` | có, lượt sau |
| Đang xử lý đơn khác quá 6 giây | 503 | `dang_ban` | có, lượt sau |
| Lỗi bên trong | 500 | `loi_he_thong` | có, lượt sau |

`chi_tiet` đi kèm khi có, ví dụ `"ij-alpha3-zz / 42"`.

Gọn lại: **4xx thì đừng gọi lại** (gọi bao nhiêu lần cũng thế), **5xx thì gọi
lại lượt sau** (phần chống trùng lo việc gọi lặp).

---

## Mấy chỗ nói thêm

**Mã SKU và size.** Không phân biệt hoa thường, bỏ khoảng trắng hai đầu. Mã phụ
(mã cũ) đã khai trong kho cũng nhận, tự quy về mã chính. Hai dòng cùng mã cùng
size trong một đơn thì cộng dồn.

**Mã phối** (vd `x-gtnxanhhong`): trừ y như khi chủ shop xuất tay — dùng đôi phối
có sẵn trước, thiếu thì tách một đôi mỗi màu ra ghép. `ton_moi` khi đó có cả
hai mã màu.

**Hoàn** theo đúng các dòng lúc trừ, không theo `hang` gửi kèm lệnh hoàn. Nếu
`hang` khác lúc trừ thì vẫn hoàn theo lúc trừ và báo
`canh_bao: [{ "ly_do": "hang_khac_luc_tru", "luc_tru": [...] }]`. Trả hàng một
phần chưa hỗ trợ — một đơn hoàn một lần.

**Chủ shop đã huỷ tay** đơn đó trong phần mềm kho rồi thì lệnh hoàn không cộng
lần hai: trả `200`, `da_lam: true`, kèm
`canh_bao: [{ "ly_do": "da_huy_trong_phan_mem", ... }]`.

**Trả lời nhanh.** Thường dưới 1 giây. Hai lượt gọi đến cùng lúc thì xếp hàng
(tối đa 6 giây), quá thì `503 dang_ban`.

**Đơn web hiện trong phần mềm kho** như mọi đơn khác: vào Nhật ký với nhãn
*Web* và mã `LP…`, được tính vào Bán chạy, huỷ được ở tab Huỷ đơn bằng mã `LP…`.
