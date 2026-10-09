/**
 * /tra-ve — bên quét mã (shopbongdavn/quetma) gọi vào khi quét đơn trả về.
 *
 * Hai việc, tách đôi có chủ ý:
 *
 *   GET  /tra-ve?ma=<mã quét được>   chỉ TRA CỨU. Trả về mã đơn, mã vận chuyển
 *                                    và danh sách SKU để trang quét hiện lên
 *                                    màn hình. KHÔNG đụng tồn kho.
 *   POST /tra-ve { ma: "<mã>" }      mới thật sự TRẢ VỀ KHO: cộng lại tồn và
 *                                    đánh dấu huỷ các lượt xuất tương ứng.
 *
 * Tách ra vì quét nhầm một đơn mà cộng tồn ngay thì sai số tồn, mà sai tồn là
 * sai tiền. Người quét nhìn đúng đơn trên màn hình rồi mới bấm xác nhận.
 *
 * Khác /tru-ton ở chỗ tìm theo MÃ VẬN CHUYỂN (hoặc mã đơn) chứ không theo
 * ma_don của lệnh trừ — vì người quét chỉ có cái mã in trên gói hàng trong tay.
 * Nhờ vậy đơn nhập tay trong phần mềm kho cũng trả về được, không chỉ đơn web.
 *
 * Dùng chung khoá TRU_TON_KHOA. Khoá KHÔNG được để trong trang quét (ai mở
 * trang cũng xem được mã nguồn) — trang quét gọi qua Worker của chính nó, khoá
 * nằm ở Cloudflare Secret bên đó.
 */

import {
  json, loi, chuanSku, chuanSz, oVaoO, oRaChu, maNgau, gioVN, chuanMa,
  giongKhoa, layVe, taoFb, doc, giuKhoa, traKhoa, thieuBien, themCors
} from "./truton.js";
import { traNoiMa } from "./noima.js";

/* Vẫn cho nhập từ đây như trước, khỏi phải sửa mọi chỗ đang dùng */
export { chuanMa };

/** Bao nhiêu lượt xuất tải về khi phải quét toàn bộ (chưa khai .indexOn). */
const QUET_TOI_DA = 20000;
/** Giữ bản quét toàn bộ bấy nhiêu lâu, khỏi tải lại mỗi lần quét một mã. */
const CACHE_MS = 60000;

let cacheMoves = { luc: 0, data: null };

/** Một ô track/order có thể chứa nhiều mã ghép bằng dấu phẩy. */
function tachMa(v) {
  return String(v == null ? "" : v).split(",").map(chuanMa).filter(Boolean);
}

/**
 * Tìm theo mã quét được; không ra thì hỏi bảng nối rồi tìm lại theo mã đơn hàng.
 *
 * Gói BOOM HÀNG quay về mang đúng mã vận chuyển lúc gửi đi, nên tìm thẳng là ra.
 * Gói TRẢ HÀNG HOÀN TIỀN thì sàn sinh một mã vận đơn MỚI, sinh ra sau lúc xuất
 * kho nên trong moves không thể có. Bảng noi-ma (chủ shop nạp từ file/trang của
 * sàn qua /noi-ma) cho biết mã đó thuộc đơn nào — có mã đơn là tìm ra đủ lượt
 * xuất như thường.
 */
async function timMovesDayDu(fb, ma) {
  const thang = await timMoves(fb, ma);
  if (Object.keys(thang.moves).length) return thang;

  let noi = null;
  /* Bảng nối hỏng thì cũng chỉ như chưa nạp — không được chặn việc quét */
  try { noi = await traNoiMa(fb, ma); } catch (e) { noi = null; }
  if (!noi) return thang;

  let qua = await timMoves(fb, noi.order);
  const nenNoi = { ...noi, ma_quet: String(ma) };

  /* Chỉ mục của Firebase so KHỚP ĐÚNG NGUYÊN VĂN — không bỏ dấu cách, không
     tách ô chứa nhiều mã ngăn bằng dấu phẩy. Nên đơn có thật trong kho mà ô
     order ghi khác định dạng một chút là chỉ mục trượt.

     Tới đây thì đã biết chắc mã này thuộc đơn nào, chỉ là không tìm ra — bỏ công
     quét toàn bộ một lượt cho chắc. Hiếm khi chạy tới đây nên không lo chậm. */
  if (!Object.keys(qua.moves).length && qua.cach === "chi-muc") {
    qua = await timMoves(fb, noi.order, true);
    if (Object.keys(qua.moves).length) {
      qua.canh_bao = [...qua.canh_bao, { ly_do: "chi_muc_truot_phai_quet_toan_bo",
        chi_tiet: "ô order trong kho ghi khác định dạng mã đơn bên sàn" }];
    }
  }

  if (!Object.keys(qua.moves).length) {
    /* Nối được nhưng kho không có đơn đó: nói rõ, đừng để chủ shop tưởng chưa
       nạp rồi đi nạp lại mãi. */
    return { ...thang, noi_ma: { ...nenNoi, kho_khong_co_don: true } };
  }
  return { moves: qua.moves, cach: qua.cach, canh_bao: qua.canh_bao, noi_ma: nenNoi };
}

/**
 * Tìm các lượt xuất khớp mã quét được.
 *
 * Ưu tiên hỏi Firebase theo chỉ mục (nhanh, không tải cả nhánh). Chưa khai
 * .indexOn thì Firebase trả 400 — khi đó hạ xuống quét toàn bộ có giới hạn và
 * có cache, và nói rõ trong câu trả lời để chủ shop biết mà khai chỉ mục.
 */
async function timMoves(fb, ma, epQuetToanBo) {
  const can = chuanMa(ma);
  if (!can) return { moves: {}, cach: "", canh_bao: [] };

  const canh_bao = [];
  const hop = {};

  /* --- cách nhanh: hỏi theo chỉ mục --- */
  let coIndex = !epQuetToanBo;
  for (const truong of coIndex ? ["track", "order"] : []) {
    const d = "moves.json?orderBy=" + encodeURIComponent('"' + truong + '"') +
              "&equalTo=" + encodeURIComponent('"' + String(ma).trim() + '"');
    try {
      const r = await fb("", {}, d);
      if (r.status === 400) { coIndex = false; break; }
      if (!r.ok) throw new Error("hỏi " + truong + " lỗi " + r.status);
      const v = await r.json();
      for (const id in (v || {})) hop[id] = v[id];
    } catch (e) { coIndex = false; break; }
  }
  if (coIndex) return { moves: hop, cach: "chi-muc", canh_bao };

  /* --- cách chậm: quét toàn bộ, có cache --- */
  if (!epQuetToanBo) {
    canh_bao.push({
      ly_do: "chua_khai_chi_muc",
      cach_sua: 'Thêm ".indexOn": ["track","order"] vào Rules của nhánh moves cho nhanh'
    });
  }
  let tatCa = null;
  if (cacheMoves.data && Date.now() - cacheMoves.luc < CACHE_MS) {
    tatCa = cacheMoves.data;
  } else {
    tatCa = (await doc(fb, "moves")) || {};
    cacheMoves = { luc: Date.now(), data: tatCa };
  }
  let dem = 0;
  for (const id in tatCa) {
    if (++dem > QUET_TOI_DA) {
      canh_bao.push({ ly_do: "qua_nhieu_luot_xuat", da_quet: QUET_TOI_DA });
      break;
    }
    const m = tatCa[id];
    if (!m) continue;
    if (tachMa(m.track).includes(can) || tachMa(m.order).includes(can)) hop[id] = m;
  }
  return { moves: hop, cach: "quet-toan-bo", canh_bao };
}

/** Gói kết quả cho trang quét hiển thị. */
function dongGoi(ma, moves) {
  const ids = Object.keys(moves);
  const hang = [], don = new Set(), track = new Set();
  let da_tra_ve = 0;

  for (const id of ids) {
    const m = moves[id];
    hang.push({
      sku: String(m.sku || ""),
      size: String(m.size == null ? "" : m.size),
      so_luong: +m.q || 0,
      da_tra_ve: !!m.huyD,
      ...(m.huyD ? { tra_ve_luc: m.huyD + " " + (m.huyH || "") } : {})
    });
    if (m.huyD) da_tra_ve++;
    tachMa(m.order).length && String(m.order || "").split(",").forEach(x => x.trim() && don.add(x.trim()));
    tachMa(m.track).length && String(m.track || "").split(",").forEach(x => x.trim() && track.add(x.trim()));
  }

  return {
    ma: String(ma),
    tim_thay: ids.length > 0,
    so_dong: ids.length,
    ma_don: [...don].join(", "),
    ma_van_chuyen: [...track].join(", "),
    hang,
    /* đã trả về hết rồi thì trang quét báo "đơn này trả về rồi" thay vì mời bấm lại */
    da_tra_ve_het: ids.length > 0 && da_tra_ve === ids.length
  };
}

/** Cộng lại tồn và đánh dấu huỷ. Gọi lại nhiều lần cũng chỉ cộng một lần. */
async function traVeKho(fb, ma, moves) {
  const ids = Object.keys(moves);
  if (!ids.length) return { ok: false, loi: "khong_tim_thay" };

  const { d, h } = gioVN();
  const vao = {}, o = {}, kho = {}, bo_qua = [];

  const can = [...new Set(ids.filter(id => !moves[id].huyD).map(id => chuanSku(moves[id].sku)))];
  await Promise.all(can.map(async s => { kho[s] = (await doc(fb, "kho/" + s)) || {}; }));

  for (const id of ids) {
    const m = moves[id];
    if (m.huyD) {                       // đã trả về trước đó -> không cộng lần hai
      bo_qua.push({ sku: m.sku, size: String(m.size), ly_do: "da_tra_ve_truoc_do",
                    luc: m.huyD + " " + (m.huyH || "") });
      continue;
    }
    const s = chuanSku(m.sku), z = chuanSz(m.size), k = s + "|" + z;
    if (!o[k]) o[k] = oVaoO(kho[s] && kho[s][z]);
    o[k].q += +m.q || 0;
    vao["moves/" + id + "/huyD"] = d;
    vao["moves/" + id + "/huyH"] = h;
    /* Ghi rõ AI huỷ: nhật ký bên kho phân biệt "đơn quét mã huỷ về" với lượt
       huỷ tay trong phần mềm. Không có dấu này thì hai việc trông y hệt nhau. */
    vao["moves/" + id + "/huyNg"] = "quetma";
  }

  const ton_moi = {};
  for (const k in o) {
    const [s, z] = k.split("|");
    vao["kho/" + s + "/" + z] = oRaChu(o[k]);
    (ton_moi[s] = ton_moi[s] || {})[z] = o[k].q;
  }

  /* Ghi lại để chủ shop tra được: mã nào quét lúc nào, đụng vào những lượt nào */
  vao["tra-ve/" + maNgau()] = {
    luc: new Date().toISOString(), d, h, ma: String(ma).slice(0, 80),
    moves: ids.join(","), ng: "quetma", viec: "đơn quét mã huỷ về kho"
  };

  const r = await fb("", { method: "PATCH", headers: { "content-type": "application/json" },
                           body: JSON.stringify(vao) });
  if (!r.ok) throw new Error("ghi Firebase lỗi " + r.status);
  cacheMoves = { luc: 0, data: null };   // tồn vừa đổi, bỏ bản cache cũ đi

  return { ok: true, ton_moi, bo_qua, da_cong: Object.keys(o).length };
}

export async function traVe(request, env) {
  return themCors(await traVeLoi(request, env));
}

async function traVeLoi(request, env) {
  if (request.method === "OPTIONS") {
    const r = new Response(null, { status: 204 });
    r.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    r.headers.set("access-control-allow-headers", "content-type, x-khoa, X-Khoa");
    r.headers.set("access-control-max-age", "86400");
    return r;
  }

  const url = new URL(request.url);
  const maQuery = (url.searchParams.get("ma") || "").trim();

  /* GET không kèm mã = hỏi xem đường này bật chưa, không cần khoá */
  if (request.method === "GET" && !maQuery) {
    const thieu = thieuBien(env);
    return json({ ok: true, san_sang: !thieu.length, thieu });
  }
  if (request.method !== "GET" && request.method !== "POST") return loi(405, "chi_nhan_get_post");
  if (thieuBien(env).length) return loi(503, "chua_cai_dat");
  if (!(await giongKhoa(request.headers.get("X-Khoa") || "", env.TRU_TON_KHOA))) return loi(401, "khoa_sai");

  let ma = maQuery;
  if (request.method === "POST") {
    let than;
    try { than = await request.json(); } catch (e) { return loi(400, "thieu_du_lieu", "thân yêu cầu không phải JSON"); }
    ma = String((than && than.ma) || "").trim() || ma;
  }
  if (!ma) return loi(400, "thieu_du_lieu", "thiếu mã");
  if (ma.length > 80) return loi(400, "thieu_du_lieu", "mã quá dài");

  let fb, giu = null;
  try {
    fb = taoFbCoDuong(env, await layVe(env));

    /* Tra cứu: chỉ đọc, không giành khoá cho nhẹ */
    if (request.method === "GET") {
      const { moves, cach, canh_bao, noi_ma } = await timMovesDayDu(fb, ma);
      const tra = { ok: true, ...dongGoi(ma, moves), cach };
      if (noi_ma) tra.noi_ma = noi_ma;
      if (canh_bao.length) tra.canh_bao = canh_bao;
      return json(tra);
    }

    /* Trả về kho: phải xếp hàng cùng /tru-ton, không thì hai bên cùng sửa một ô */
    giu = await giuKhoa(fb);
    if (!giu) return loi(503, "dang_ban", "đang xử lý đơn khác, gọi lại sau");

    const { moves, cach, canh_bao, noi_ma } = await timMovesDayDu(fb, ma);
    const goi = dongGoi(ma, moves);
    if (!goi.tim_thay) {
      const t = { ok: true, ...goi, cach, da_lam: false, ly_do: "khong_tim_thay" };
      if (noi_ma) t.noi_ma = noi_ma;
      return json(t);
    }

    const kq = await traVeKho(fb, ma, moves);
    const tra = { ok: true, ...goi, cach, da_lam: kq.da_cong > 0,
                  ton_moi: kq.ton_moi, da_tra_ve_het: true };
    if (noi_ma) tra.noi_ma = noi_ma;
    if (kq.bo_qua && kq.bo_qua.length) tra.bo_qua = kq.bo_qua;
    if (canh_bao.length) tra.canh_bao = canh_bao;
    if (!kq.da_cong) tra.ly_do = "da_tra_ve_truoc_do";
    return json(tra);
  } catch (e) {
    return loi(500, "loi_he_thong", String(e && e.message || e).slice(0, 200));
  } finally {
    if (giu && fb) await traKhoa(fb, giu);
  }
}

/**
 * Như taoFb nhưng cho phép truyền thẳng một đường có sẵn query (?orderBy=...).
 * taoFb tự gắn ".json" nên không đặt thêm tham số được.
 */
function taoFbCoDuong(env, ve) {
  const goc = String(env.FIREBASE_URL).replace(/\/+$/, "") + "/" + env.FIREBASE_MA;
  const co = taoFb(env, ve);
  return async (duong, opt = {}, duongTho) => {
    if (!duongTho) return co(duong, opt);
    const noi = duongTho.includes("?") ? "&" : "?";
    return fetch(goc + "/" + duongTho + noi + "access_token=" + encodeURIComponent(ve), opt);
  };
}
