/**
 * Worker phục vụ trang tĩnh trong web/, kèm hai đường phụ:
 *
 *   /config.json  — địa chỉ Firebase (và Apps Script nếu còn dùng), lấy từ biến
 *                   môi trường (Settings -> Variables and Secrets). Không nằm
 *                   trong kho code, nên mở địa chỉ nào cũng nối sẵn mà không
 *                   phải nhập tay trên từng máy.
 *   /img?u=...    — tải hộ ảnh sản phẩm. Ảnh trên CDN của sàn thường hết hạn
 *                   hoặc chặn nhúng từ trang khác, nên trang không tải thẳng được.
 *                   Lấy qua đây rồi lưu hẳn ảnh lại thì về sau không mất nữa.
 */

const ANH_TOI_DA = 8 * 1024 * 1024; // 8 MB, ảnh sản phẩm không bao giờ to hơn thế

async function taiAnh(request) {
  const u = new URL(request.url).searchParams.get("u") || "";
  let dich;
  try {
    dich = new URL(u);
  } catch (e) {
    return new Response("địa chỉ ảnh không hợp lệ", { status: 400 });
  }
  if (dich.protocol !== "http:" && dich.protocol !== "https:") {
    return new Response("chỉ nhận http hoặc https", { status: 400 });
  }

  let r;
  try {
    r = await fetch(dich.toString(), {
      headers: {
        // CDN của sàn thường chặn khi không có hai dòng này
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "referer": dich.origin + "/",
        "accept": "image/avif,image/webp,image/jpeg,image/png,*/*"
      },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
  } catch (e) {
    return new Response("không tải được ảnh: " + e, { status: 502 });
  }

  if (!r.ok) {
    return new Response("nguồn ảnh trả về " + r.status, { status: 502 });
  }
  const kieu = r.headers.get("content-type") || "";
  if (!kieu.startsWith("image/")) {
    return new Response("địa chỉ này không phải ảnh (" + kieu + ")", { status: 415 });
  }
  const co = Number(r.headers.get("content-length") || 0);
  if (co > ANH_TOI_DA) {
    return new Response("ảnh quá lớn", { status: 413 });
  }

  return new Response(r.body, {
    headers: {
      "content-type": kieu,
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/config.json") {
      return new Response(JSON.stringify({
        // Firebase Realtime Database — cách đồng bộ chính
        fu: env.FIREBASE_URL || "",
        fm: env.FIREBASE_MA || "",
        // Khoá web của dự án Firebase. Khoá này vốn công khai, để lộ không sao —
        // thứ chặn người lạ là Rules bên Realtime Database, không phải khoá này.
        fk: env.FIREBASE_KEY || "",
        // Google Sheets — cách cũ, chỉ dùng khi chưa đặt Firebase
        u: env.SHEETS_URL || "",
        t: env.SHEETS_TOKEN || ""
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          // không lưu đệm, để đổi mã bảo vệ là có hiệu lực ngay
          "cache-control": "no-store"
        }
      });
    }

    if (url.pathname === "/img") return taiAnh(request);

    return env.ASSETS.fetch(request);
  }
};
