/**
 * POST /tru-ton — bên shopbongda gọi vào khi có đơn web, để trừ (hoặc hoàn) tồn.
 *
 * Ghi thẳng vào Firebase y như phần mềm kho tự ghi: đổi ô kho/<sku>/<size>,
 * thêm một dòng vào nhật ký (moves/<id>, nguồn "web", mã đơn = ma_don), nên
 * mở phần mềm lên là thấy ngay trong Nhật ký, huỷ được ở tab Huỷ đơn, và được
 * tính vào Bán chạy như mọi đơn khác.
 *
 * Chống trùng: mỗi (ma_don, viec) để lại một dấu ở web/<ma_don>_<viec>. Dấu và
 * phần trừ tồn ghi chung MỘT lệnh PATCH nhiều đường dẫn — Firebase làm trọn hoặc
 * không làm gì, nên không có chuyện trừ rồi mà quên ghi dấu. Hai lượt gọi sát
 * nhau thì xếp hàng qua một khoá ngắn (web_khoa) giành bằng ETag.
 *
 * Biến môi trường (Cloudflare → Settings → Variables and Secrets, đều là Secret):
 *   TRU_TON_KHOA  chuỗi khoá bên shopbongda gửi trong header X-Khoa (≥ 24 ký tự)
 *   FIREBASE_SA   nguyên nội dung file JSON "service account" của dự án Firebase
 *   FIREBASE_URL, FIREBASE_MA  — đã có sẵn từ trước
 */

const KHOA_GIU_MS = 20000;   // khoá xếp hàng tự hết hạn, lỡ Worker chết giữa chừng
const CHO_KHOA_MS = 6000;    // chờ tối đa bấy nhiêu, quá thì trả 503 cho lượt sau gọi lại
const SO_LUONG_TOI_DA = 1000;

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export const loi = (status, ma, chi_tiet) => json(chi_tiet ? { ok: false, loi: ma, chi_tiet } : { ok: false, loi: ma }, status);
const ngu = ms => new Promise(r => setTimeout(r, ms));

/* ---- cùng cách chuẩn hoá với phần mềm kho ---- */
export const chuanSku = v => String(v == null ? "" : v).trim().toLowerCase();
export const chuanSz = v => String(v == null ? "" : v).trim().toUpperCase();
export function oVaoO(v) {
  const t = String(v == null ? "" : v).trim().toUpperCase();
  if (t.charAt(0) === "N") return { q: Math.round(+t.slice(1) || 0), lock: true };
  return { q: Math.round(+t || 0), lock: false };
}
export const oRaChu = c => c.lock ? ("N" + (c.q || "")) : (c.q || 0);
/* Khoá Firebase không được chứa . $ # [ ] / */
export const khoaFb = v => String(v).replace(/[.$#\[\]\/\s]/g, "_").slice(0, 120);
export const maNgau = () => {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return Array.from(b, x => (x % 36).toString(36)).join("");
};
/** Giờ Việt Nam: Worker chạy giờ UTC, còn nhật ký trong phần mềm ghi giờ máy ở VN. */
export function gioVN() {
  const t = new Date(Date.now() + 7 * 3600e3).toISOString();
  return { d: t.slice(0, 10), h: t.slice(11, 16) };
}

/** So hai chuỗi mà không để lộ độ dài khớp qua thời gian chạy. */
export async function giongKhoa(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b)))
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let khac = 0;
  for (let i = 0; i < u.length; i++) khac |= u[i] ^ v[i];
  return khac === 0;
}

/* ---- vé vào Firebase bằng service account (không vướng Rules) ---- */
let veCache = { ve: "", het: 0 };
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlChu = s => b64url(new TextEncoder().encode(s));
function pemRaDer(pem) {
  const s = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const nhi = atob(s), out = new Uint8Array(nhi.length);
  for (let i = 0; i < nhi.length; i++) out[i] = nhi.charCodeAt(i);
  return out.buffer;
}
export async function layVe(env) {
  if (veCache.ve && Date.now() < veCache.het) return veCache.ve;
  const sa = JSON.parse(env.FIREBASE_SA);
  const bay = Math.floor(Date.now() / 1000);
  const dau = b64urlChu(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const than = b64urlChu(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: bay, exp: bay + 3600
  }));
  const khoa = await crypto.subtle.importKey("pkcs8", pemRaDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const ky = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", khoa,
    new TextEncoder().encode(dau + "." + than));
  const r = await fetch(env.FIREBASE_TOKEN_URL || sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion="
      + dau + "." + than + "." + b64url(ky)
  });
  if (!r.ok) throw new Error("Google không cấp vé (" + r.status + ") — xem lại FIREBASE_SA");
  const j = await r.json();
  veCache = { ve: j.access_token, het: Date.now() + Math.max(60, (+j.expires_in || 3600) - 300) * 1000 };
  return veCache.ve;
}

/** Gọi REST của Firebase dưới nhánh mã kho. */
export function taoFb(env, ve) {
  const goc = String(env.FIREBASE_URL).replace(/\/+$/, "") + "/" + env.FIREBASE_MA;
  return async (duong, opt = {}) => {
    const u = goc + (duong ? "/" + duong : "") + ".json?access_token=" + encodeURIComponent(ve);
    const r = await fetch(u, opt);
    return r;
  };
}
export async function doc(fb, duong) {
  const r = await fb(duong);
  if (!r.ok) throw new Error("đọc " + duong + " lỗi " + r.status);
  return r.json();
}

/* ---- khoá xếp hàng ---- */
export async function giuKhoa(fb) {
  const toi = Date.now() + CHO_KHOA_MS, toiLa = maNgau();
  while (Date.now() < toi) {
    const r = await fb("web_khoa", { headers: { "X-Firebase-ETag": "true" } });
    if (!r.ok) throw new Error("đọc khoá lỗi " + r.status);
    const tag = r.headers.get("ETag"), v = await r.json();
    if (v && +v.han > Date.now()) { await ngu(250); continue; }
    const p = await fb("web_khoa", {
      method: "PUT", headers: { "if-match": tag, "content-type": "application/json" },
      body: JSON.stringify({ han: Date.now() + KHOA_GIU_MS, id: toiLa })
    });
    if (p.ok) return toiLa;
    if (p.status !== 412) throw new Error("giành khoá lỗi " + p.status);
  }
  return null;
}
export async function traKhoa(fb, id) {
  try {
    const r = await fb("web_khoa", { headers: { "X-Firebase-ETag": "true" } });
    const tag = r.headers.get("ETag"), v = await r.json();
    if (v && v.id === id) await fb("web_khoa", { method: "DELETE", headers: { "if-match": tag } });
  } catch (e) { /* khoá tự hết hạn sau KHOA_GIU_MS */ }
}

/* ---- đọc đơn gửi tới ---- */
function docDon(b) {
  if (!b || typeof b !== "object") return { loi: "thieu_du_lieu", chi_tiet: "thân yêu cầu không phải JSON" };
  const ma_don = String(b.ma_don == null ? "" : b.ma_don).trim();
  const viec = String(b.viec == null ? "" : b.viec).trim().toLowerCase();
  if (!ma_don) return { loi: "thieu_du_lieu", chi_tiet: "thiếu ma_don" };
  if (ma_don.length > 60) return { loi: "thieu_du_lieu", chi_tiet: "ma_don quá dài" };
  if (viec !== "tru" && viec !== "hoan" && viec !== "tay")
    return { loi: "thieu_du_lieu", chi_tiet: "viec phải là \"tru\", \"hoan\" hoặc \"tay\"" };
  if (!Array.isArray(b.hang) || !b.hang.length) return { loi: "thieu_du_lieu", chi_tiet: "hang rỗng" };
  const gop = new Map();
  /* Mỗi dòng hàng có thể kèm mã vận đơn và mã đơn RIÊNG của nó (bên gọi gộp
     nhiều đơn vào một lệnh cho Nhật ký gọn). Hai mã này chỉ để hiện trong Nhật
     ký, không ảnh hưởng việc trừ. Không gửi cũng được — khi đó dùng ma_don chung. */
  const gonMa = v => String(v == null ? "" : v).trim().slice(0, 40);
  for (const h of b.hang) {
    const sku = chuanSku(h && h.sku), size = chuanSz(h && h.size), q = Number(h && h.so_luong);
    if (!sku || !size) return { loi: "thieu_du_lieu", chi_tiet: "dòng hàng thiếu sku hoặc size" };
    if (!Number.isInteger(q) || q <= 0 || q > SO_LUONG_TOI_DA)
      return { loi: "thieu_du_lieu", chi_tiet: "so_luong phải là số nguyên dương: " + sku + " / " + size };
    const k = sku + "|" + size;
    const cu = gop.get(k);
    const track = new Set(cu ? cu.track : []), don = new Set(cu ? cu.don : []);
    if (gonMa(h && h.track)) track.add(gonMa(h.track));
    if (gonMa(h && h.don)) don.add(gonMa(h.don));
    gop.set(k, { sku, size, q: (cu ? cu.q : 0) + q, track: [...track], don: [...don],
                 ly: String((h && h.ly) == null ? "" : h.ly).trim().slice(0, 80) || (cu ? cu.ly : "") });
  }
  return { ma_don, viec, hang: [...gop.values()] };
}

/* ---- trừ ---- */
async function tru(fb, don, dau) {
  const [mh, nhom, szMac] = await Promise.all([doc(fb, "mh"), doc(fb, "nhom"), doc(fb, "cai/sizes")]);
  const bangMh = mh || {}, bangNhom = nhom || {};
  const phu = {};
  for (const sku in bangMh) String(bangMh[sku].phu || "").split(",").map(chuanSku).filter(Boolean)
    .forEach(p => { if (!phu[p]) phu[p] = sku; });
  const maChinh = s => bangMh[s] ? s : (phu[s] || null);
  const daiSize = sku => {
    const g = bangNhom[(bangMh[sku] || {}).gid];
    const ds = String((g && g.sizes) || szMac || "").split(",").map(chuanSz).filter(Boolean);
    return ds;
  };
  const dsPhoi = sku => String((bangMh[sku] || {}).phoi || "").split(",").map(chuanSku).filter(Boolean);

  /* đối chiếu từng dòng trước, sai một dòng là không trừ dòng nào */
  const dong = [];
  for (const h of don.hang) {
    const sku = maChinh(h.sku);
    if (!sku) return loi(409, "sku_khong_co", h.sku + " / " + h.size);
    if (!daiSize(sku).includes(h.size)) return loi(409, "size_khong_co", h.sku + " / " + h.size);
    dong.push({ sku, size: h.size, q: h.q, goc: h.sku, track: h.track, don: h.don });
  }

  /* đọc tồn của mọi mã dính tới, kể cả hai màu của mã phối */
  const canDoc = new Set();
  dong.forEach(x => { canDoc.add(x.sku); dsPhoi(x.sku).forEach(s => { if (bangMh[s]) canDoc.add(s); }); });
  const kho = {};
  await Promise.all([...canDoc].map(async s => { kho[s] = (await doc(fb, "kho/" + s)) || {}; }));
  const o = {};                                   // ô đang tính: "sku|size" → {q, lock}
  const oCua = (s, z) => { const k = s + "|" + z; if (!o[k]) o[k] = oVaoO(kho[s] && kho[s][z]); return o[k]; };

  const { d, h } = gioVN(), lo = maNgau(), vao = {}, ids = [], canh_bao = [];
  for (const x of dong) {
    const c = oCua(x.sku, x.size), truoc = c.q;
    const mau = dsPhoi(x.sku).filter(s => bangMh[s]);
    let tach = null;
    /* mã phối: dùng đôi phối có sẵn trước, thiếu mới tách một đôi mỗi màu ra ghép —
       đúng như phần mềm làm khi xuất tay (truPhoi) */
    if (mau.length >= 2) {
      const co = Math.max(0, c.q), con = x.q - Math.min(co, x.q), lan = Math.ceil(con / 2);
      const tachDuoc = Math.max(0, Math.min(...mau.map(s => oCua(s, x.size).q)));
      if (lan && lan <= tachDuoc) {
        mau.forEach(s => { oCua(s, x.size).q -= lan; });
        c.q = c.q + lan * 2 - x.q;
        tach = { lan, ds: mau };
      }
    }
    if (!tach) {
      if (truoc < x.q) canh_bao.push({ sku: x.sku, size: x.size, truoc, mua: x.q });
      c.q -= x.q;
    }
    const id = maNgau();
    ids.push(id);
    vao["moves/" + id] = {
      d, h, t: "out", sku: x.sku, size: x.size, q: x.q,
      track: (x.track || []).join(", ").slice(0, 80),
      order: (x.don || []).join(", ").slice(0, 80) || don.ma_don, ma2: "",
      note: (x.don || []).length
        ? "Đơn " + (x.don || []).join(", ").slice(0, 80)
        : "Đơn web " + don.ma_don,
      digits: "", lo, ng: "web", chu: "", chuMa: "",
      tach: tach ? tach.ds.join(",") : "", lan: tach ? tach.lan : 0, huyD: "", huyH: ""
    };
  }
  const ton_moi = {};
  for (const k in o) {
    const [s, z] = k.split("|");
    vao["kho/" + s + "/" + z] = oRaChu(o[k]);
    (ton_moi[s] = ton_moi[s] || {})[z] = o[k].q;
  }
  vao["web/" + dau] = {
    luc: new Date().toISOString(), d, h, moves: ids.join(","),
    hang: JSON.stringify(dong.map(x => [x.sku, x.size, x.q])),
    ton_moi: JSON.stringify(ton_moi), canh_bao: JSON.stringify(canh_bao)
  };
  const r = await fb("", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(vao) });
  if (!r.ok) throw new Error("ghi Firebase lỗi " + r.status);
  const tra = { ok: true, ma_don: don.ma_don, da_lam: true, ton_moi };
  if (canh_bao.length) tra.canh_bao = canh_bao;
  return json(tra);
}

/* ---- cần trừ tay ----
   Bên in tem gặp mã kho chưa khai (hoặc size kho không có) thì không trừ được;
   trước đây nó chỉ hiện trên máy chủ shop rồi mất. Nay ghi hẳn vào đây để phần
   mềm kho hiện lên đầu Nhật ký: mã gì, size nào, mấy đôi, đơn nào, vì sao.
   KHÔNG đổi tồn, KHÔNG tạo lượt xuất — nên mã chưa khai cũng ghi được. */
async function nhacTay(fb, don, dau) {
  const { d, h } = gioVN(), lo = maNgau(), vao = {}, ids = [];
  for (const x of don.hang) {
    const id = maNgau();
    ids.push(id);
    vao["tay/" + id] = {
      d, h, sku: x.sku, size: x.size, q: x.q, lo, ng: "web",
      track: (x.track || []).join(", ").slice(0, 80),
      order: (x.don || []).join(", ").slice(0, 80) || don.ma_don,
      ly: x.ly || "", xong: ""
    };
  }
  vao["web/" + dau] = {
    luc: new Date().toISOString(), d, h, moves: "", tay: ids.join(","),
    hang: JSON.stringify(don.hang.map(x => [x.sku, x.size, x.q])),
    ton_moi: "null", canh_bao: "[]"
  };
  const r = await fb("", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(vao) });
  if (!r.ok) throw new Error("ghi Firebase lỗi " + r.status);
  return json({ ok: true, ma_don: don.ma_don, da_lam: true, da_ghi_nhac: ids.length });
}

/* ---- hoàn ---- */
async function hoan(fb, don, dau) {
  const daTru = await doc(fb, "web/" + khoaFb(don.ma_don) + "_tru");
  if (!daTru) return loi(409, "chua_tru", don.ma_don);
  const ids = String(daTru.moves || "").split(",").filter(Boolean);
  const moves = {};
  await Promise.all(ids.map(async id => { moves[id] = await doc(fb, "moves/" + id); }));

  const { d, h } = gioVN(), vao = {}, canh_bao = [], o = {}, kho = {};
  const can = [...new Set(ids.filter(id => moves[id] && !moves[id].huyD).map(id => chuanSku(moves[id].sku)))];
  await Promise.all(can.map(async s => { kho[s] = (await doc(fb, "kho/" + s)) || {}; }));
  for (const id of ids) {
    const m = moves[id];
    /* chủ shop đã huỷ tay trong phần mềm, hoặc đã xoá lượt xuất: không cộng lần nữa */
    if (!m) { canh_bao.push({ ly_do: "luot_xuat_da_xoa", id }); continue; }
    if (m.huyD) {
      canh_bao.push({ ly_do: "da_huy_trong_phan_mem", sku: m.sku, size: String(m.size), luc: m.huyD + " " + (m.huyH || "") });
      continue;
    }
    const s = chuanSku(m.sku), z = chuanSz(m.size), k = s + "|" + z;
    if (!o[k]) o[k] = oVaoO(kho[s] && kho[s][z]);
    o[k].q += +m.q || 0;
    vao["moves/" + id + "/huyD"] = d;
    vao["moves/" + id + "/huyH"] = h;
  }
  const ton_moi = {};
  for (const k in o) {
    const [s, z] = k.split("|");
    vao["kho/" + s + "/" + z] = oRaChu(o[k]);
    (ton_moi[s] = ton_moi[s] || {})[z] = o[k].q;
  }
  /* hàng gửi kèm lệnh hoàn khác hàng lúc trừ: vẫn hoàn theo đúng lúc trừ, báo lại */
  let luc = []; try { luc = JSON.parse(daTru.hang || "[]"); } catch (e) { }
  const k1 = luc.map(r => r.join("|")).sort().join(";");
  const k2 = don.hang.map(x => [x.sku, x.size, x.q].join("|")).sort().join(";");
  if (k1 && k1 !== k2) canh_bao.push({ ly_do: "hang_khac_luc_tru", luc_tru: luc.map(r => ({ sku: r[0], size: r[1], so_luong: r[2] })) });

  vao["web/" + dau] = {
    luc: new Date().toISOString(), d, h, moves: ids.join(","),
    hang: JSON.stringify(don.hang.map(x => [x.sku, x.size, x.q])),
    ton_moi: JSON.stringify(ton_moi), canh_bao: JSON.stringify(canh_bao)
  };
  const r = await fb("", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(vao) });
  if (!r.ok) throw new Error("ghi Firebase lỗi " + r.status);
  const tra = { ok: true, ma_don: don.ma_don, da_lam: true, ton_moi };
  if (canh_bao.length) tra.canh_bao = canh_bao;
  return json(tra);
}

/** Còn thiếu biến nào để chạy được. Chỉ báo tên biến, không bao giờ báo giá trị. */
export function thieuBien(env) {
  const t = [];
  if (!env.FIREBASE_URL) t.push("FIREBASE_URL");
  if (!env.FIREBASE_MA) t.push("FIREBASE_MA");
  if (String(env.TRU_TON_KHOA || "").length < 24) t.push("TRU_TON_KHOA");
  try { const sa = JSON.parse(env.FIREBASE_SA || ""); if (!sa.client_email || !sa.private_key) throw 0; }
  catch (e) { t.push("FIREBASE_SA"); }
  return t;
}

/* Mở cửa cho trang khác gọi từ trình duyệt. Chủ shop yêu cầu để phần mềm in tem
   (quanlyfilein) tự trừ tồn ngay khi xuất đơn, khỏi phải kéo file sang tay.
   Mở CORS KHÔNG làm yếu bảo mật: chặn cửa vẫn là khoá X-Khoa, và trình duyệt
   không tự gửi cookie kèm theo (dùng "*" nên credentials luôn bị chặn). */
export const themCors = r => {
  r.headers.set("access-control-allow-origin", "*");
  r.headers.set("access-control-expose-headers", "content-type");
  return r;
};

/* Vỏ ngoài: mọi câu trả lời của /tru-ton đều kèm header CORS, kể cả lỗi —
   không thì trình duyệt chặn, bên gọi chỉ thấy "lỗi mạng" không rõ lý do. */
export async function truTon(request, env) {
  return themCors(await truTonLoi(request, env));
}

async function truTonLoi(request, env) {
  /* Trình duyệt hỏi trước (preflight) vì có header lạ X-Khoa và thân JSON */
  if (request.method === "OPTIONS") {
    const r = new Response(null, { status: 204 });
    r.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    r.headers.set("access-control-allow-headers", "content-type, x-khoa, X-Khoa");
    r.headers.set("access-control-max-age", "86400");
    return r;
  }
  if (request.method === "GET") {
    const thieu = thieuBien(env);
    return json({ ok: true, san_sang: !thieu.length, thieu });
  }
  if (request.method !== "POST") return loi(405, "chi_nhan_post");
  if (thieuBien(env).length) return loi(503, "chua_cai_dat");
  if (!(await giongKhoa(request.headers.get("X-Khoa") || "", env.TRU_TON_KHOA))) return loi(401, "khoa_sai");

  let than;
  try { than = await request.json(); } catch (e) { return loi(400, "thieu_du_lieu", "thân yêu cầu không phải JSON"); }
  const don = docDon(than);
  if (don.loi) return loi(400, don.loi, don.chi_tiet);

  let fb, giu = null;
  try {
    fb = taoFb(env, await layVe(env));
    giu = await giuKhoa(fb);
    if (!giu) return loi(503, "dang_ban", "đang xử lý đơn khác, gọi lại sau");
    const dau = khoaFb(don.ma_don) + "_" + don.viec;
    const cu = await doc(fb, "web/" + dau);
    if (cu) {
      let ton_moi; try { ton_moi = JSON.parse(cu.ton_moi || "null"); } catch (e) { }
      return json({ ok: true, ma_don: don.ma_don, da_lam: false, ly_do: "da_lam_truoc_do",
        luc: cu.luc || "", ...(ton_moi ? { ton_moi } : {}) });
    }
    if (don.viec === "tay") return await nhacTay(fb, don, dau);
    return don.viec === "tru" ? await tru(fb, don, dau) : await hoan(fb, don, dau);
  } catch (e) {
    return loi(500, "loi_he_thong", String(e && e.message || e).slice(0, 200));
  } finally {
    if (giu && fb) await traKhoa(fb, giu);
  }
}
