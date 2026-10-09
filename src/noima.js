/**
 * /noi-ma — bảng nối "mã vận đơn trả hàng" → "mã đơn hàng".
 *
 * VÌ SAO CẦN:
 * Đơn boom hàng quay về mang ĐÚNG mã vận chuyển lúc gửi đi, nên /tra-ve tìm ra
 * ngay trong moves. Nhưng đơn TRẢ HÀNG HOÀN TIỀN thì sàn sinh một mã vận đơn
 * MỚI, sinh ra sau lúc xuất kho — trong moves không thể có. Quét gói đó là
 * không ra đơn nào, dù mã đơn hàng vẫn y nguyên.
 *
 * Kho không tự biết được cặp mã ấy. Phải nạp từ sàn vào: chủ shop tải file CSV
 * đơn trả hàng bên TikTok, hoặc dán nội dung trang trả hàng bên Shopee, trang
 * nạp bóc ra từng cặp rồi gửi vào đây.
 *
 *   POST /noi-ma { cap: [{ ma, order, tt, san }, ...] }   nạp, ghi đè mã đã có
 *   GET  /noi-ma?ma=<mã>                                  tra một mã, để soi
 *   GET  /noi-ma                                          đếm xem đang có bao nhiêu
 *
 * Dùng chung khoá TRU_TON_KHOA như /tru-ton và /tra-ve.
 *
 * KHÔNG đụng tới tồn kho, nên không phải xếp hàng chung khoá web_khoa — nạp
 * nghìn cặp mã lúc nào cũng được, không chặn người đang quét.
 */

import {
  json, loi, maNgau, chuanMa, giongKhoa, layVe, taoFb, doc, thieuBien, themCors
} from "./truton.js";

/** Nạp tối đa bấy nhiêu cặp một lần gọi. Trang nạp tự cắt thành nhiều đợt. */
const NAP_TOI_DA = 3000;
/** Mỗi lần PATCH ghi bấy nhiêu cặp, khỏi dựng một thân yêu cầu quá to. */
const MOI_DOT = 500;

/** Trạng thái sàn báo, gói về hai nhóm cho dễ hiểu. */
const chuanTt = v => {
  const f = String(v == null ? "" : v).trim().toLowerCase();
  if (!f) return "chua_ro";
  return f === "da_ve" || f === "cho_ve" || f === "that_lac" ? f : "chua_ro";
};

const chuanSan = v => {
  const f = String(v == null ? "" : v).trim().toLowerCase();
  return f === "shopee" || f === "tiktok" ? f : "";
};

/**
 * Tra một mã vận đơn trả hàng xem nối với đơn nào.
 * Trả về null nếu chưa nạp. Dùng cả trong /tra-ve.
 */
export async function traNoiMa(fb, ma) {
  const can = chuanMa(ma);
  if (!can) return null;
  const v = await doc(fb, "noi-ma/" + can);
  return v && v.order ? v : null;
}

/** Lọc và gom danh sách cặp mã gửi lên, trả về cái dùng được và cái bỏ. */
function locCap(cap) {
  const dung = new Map();   // mã chuẩn -> { ma_goc, order, tt, san }
  const bo = [];

  for (const c of cap) {
    const maGoc = String((c && c.ma) || "").trim();
    const order = String((c && c.order) || "").trim();
    const can = chuanMa(maGoc);

    if (!can) { bo.push({ ma: maGoc, ly_do: "thieu_ma" }); continue; }
    if (!order) { bo.push({ ma: maGoc, ly_do: "thieu_ma_don" }); continue; }
    if (maGoc.length > 80 || order.length > 80) {
      bo.push({ ma: maGoc, ly_do: "ma_qua_dai" }); continue;
    }
    /* Mã vận đơn trả TRÙNG mã đơn hàng nghĩa là bóc tách sai — nối vào thì sau
       này quét ra đơn bậy, nguy hiểm hơn là không nối. Bỏ thẳng. */
    if (can === chuanMa(order)) { bo.push({ ma: maGoc, ly_do: "ma_trung_ma_don" }); continue; }

    /* Cùng một mã xuất hiện hai lần trong một lần nạp: lấy cái sau, vì danh
       sách sàn xuất ra thường xếp cũ trước mới sau. */
    dung.set(can, { ma: maGoc, order, tt: chuanTt(c && c.tt), san: chuanSan(c && c.san) });
  }
  return { dung, bo };
}

/**
 * @param thu  true = chỉ XEM TRƯỚC, không ghi gì. Trang nạp gọi ngay sau khi bóc
 *             tách để đánh dấu từng dòng "mới" hay "đã có", cho chủ shop thấy
 *             mã trùng TRƯỚC khi bấm nạp chứ không phải sau.
 */
async function napCap(fb, cap, thu) {
  const { dung, bo } = locCap(cap);
  if (!dung.size) return { da_nap: 0, moi: 0, da_co: 0, doi_don: [], bo_qua: bo, tung_ma: [] };

  /* Đọc bảng cũ để biết mã nào mới, mã nào đã có mà ĐỔI mã đơn — đổi là dấu
     hiệu bóc tách sai hoặc sàn sửa đơn, phải báo cho chủ shop chứ không âm thầm
     ghi đè. Và để giữ lại mốc lan_dau.

     ĐỌC CẢ BẢNG MỘT LƯỢT, không đọc từng mã: mỗi lần chạy Worker chỉ được gọi
     ra ngoài tối đa 50 lượt, nạp 70 cặp mà đọc từng mã là vượt ngay
     ("Too many subrequests by single Worker invocation"). Bảng này mỗi dòng chỉ
     trăm byte, tải cả về vẫn nhẹ hơn nhiều so với tách ra từng lượt. */
  let cu = {};
  try { cu = (await doc(fb, "noi-ma")) || {}; } catch (e) { cu = {}; }

  const luc = new Date().toISOString();
  const vao = {};
  let moi = 0, da_co = 0;
  const doi_don = [];
  const tung_ma = [];

  for (const [can, c] of dung) {
    const truoc = cu[can];
    if (!truoc) { moi++; tung_ma.push({ ma: c.ma, tt: "moi" }); }
    else if (String(truoc.order) !== c.order) {
      da_co++;
      doi_don.push({ ma: c.ma, don_cu: String(truoc.order), don_moi: c.order });
      tung_ma.push({ ma: c.ma, tt: "doi_don", don_cu: String(truoc.order) });
    } else {
      da_co++;
      tung_ma.push({ ma: c.ma, tt: "da_co", lan_dau: String(truoc.lan_dau || truoc.luc || "") });
    }
    vao[can] = {
      order: c.order,
      ma_goc: c.ma,
      tt: c.tt,
      ...(c.san ? { san: c.san } : {}),
      luc,
      /* giữ lần nạp đầu để tra lại về sau, ghi đè bao nhiêu lần cũng không mất */
      lan_dau: (truoc && truoc.lan_dau) || luc
    };
  }

  const tenKey = Object.keys(vao);

  /* Xem trước thì dừng ở đây — không ghi một chữ nào vào kho */
  if (thu) return { da_nap: 0, xem_truoc: true, so_cap: tenKey.length,
                    moi, da_co, doi_don, bo_qua: bo, tung_ma };

  for (let i = 0; i < tenKey.length; i += MOI_DOT) {
    const dot = {};
    for (const k of tenKey.slice(i, i + MOI_DOT)) dot[k] = vao[k];
    const r = await fb("noi-ma", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dot)
    });
    if (!r.ok) throw new Error("ghi noi-ma lỗi " + r.status);
  }

  /* Ghi lại mỗi lần nạp để sau còn tra: ai nạp, lúc nào, bao nhiêu cặp */
  await fb("noi-ma-log/" + maNgau(), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ luc, so_cap: tenKey.length, moi, da_co,
                           doi_don: doi_don.length, bo_qua: bo.length, ng: "nap" })
  });

  return { da_nap: tenKey.length, moi, da_co, doi_don, bo_qua: bo, tung_ma };
}

export async function noiMa(request, env) {
  return themCors(await noiMaLoi(request, env));
}

async function noiMaLoi(request, env) {
  if (request.method === "OPTIONS") {
    const r = new Response(null, { status: 204 });
    r.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    r.headers.set("access-control-allow-headers", "content-type, x-khoa, X-Khoa");
    r.headers.set("access-control-max-age", "86400");
    return r;
  }
  if (request.method !== "GET" && request.method !== "POST") return loi(405, "chi_nhan_get_post");
  if (thieuBien(env).length) return loi(503, "chua_cai_dat");
  if (!(await giongKhoa(request.headers.get("X-Khoa") || "", env.TRU_TON_KHOA))) {
    return loi(401, "khoa_sai");
  }

  let fb;
  try {
    const ve = await layVe(env);
    fb = taoFb(env, ve);

    if (request.method === "GET") {
      const tham = new URL(request.url).searchParams;
      const ma = (tham.get("ma") || "").trim();

      /* Nhật ký: mấy lần nạp gần đây và mấy lượt trả về kho gần đây. Để chủ shop
         xem thẳng trong phần mềm, khỏi phải mở Firebase Console. */
      if (tham.get("log")) {
        const bao = Math.min(Math.max(+tham.get("so") || 30, 1), 200);
        const gan = (o, sapXep) => Object.entries(o || {})
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => String(b[sapXep] || "") < String(a[sapXep] || "") ? -1 : 1)
          .slice(0, bao);
        const [lanNap, luotTra] = await Promise.all([
          doc(fb, "noi-ma-log").catch(() => ({})),
          doc(fb, "tra-ve").catch(() => ({}))
        ]);
        return json({ ok: true, nap: gan(lanNap, "luc"), tra_ve: gan(luotTra, "luc") });
      }

      if (ma) {
        const v = await traNoiMa(fb, ma);
        return json({ ok: true, ma, tim_thay: !!v, ...(v ? { noi: v } : {}) });
      }
      /* Không kèm mã: đếm xem đang nối được bao nhiêu mã. shallow=true chỉ lấy
         tên khoá chứ không kéo cả bảng về — bảng này có thể hàng nghìn dòng. */
      const goc = String(env.FIREBASE_URL).replace(/\/+$/, "") + "/" + env.FIREBASE_MA;
      const rr = await fetch(goc + "/noi-ma.json?shallow=true&access_token=" + encodeURIComponent(ve));
      if (!rr.ok) throw new Error("đếm noi-ma lỗi " + rr.status);
      const ds = await rr.json();
      return json({ ok: true, so_ma: ds ? Object.keys(ds).length : 0 });
    }

    let than;
    try { than = await request.json(); } catch (e) {
      return loi(400, "thieu_du_lieu", "thân yêu cầu không phải JSON");
    }
    const cap = than && Array.isArray(than.cap) ? than.cap : null;
    if (!cap) return loi(400, "thieu_du_lieu", 'thiếu mảng "cap"');
    if (!cap.length) return json({ ok: true, da_nap: 0, moi: 0, da_co: 0,
                                   doi_don: [], bo_qua: [], tung_ma: [] });
    if (cap.length > NAP_TOI_DA) {
      return loi(400, "qua_nhieu", "mỗi lần nạp tối đa " + NAP_TOI_DA + " cặp");
    }

    const kq = await napCap(fb, cap, !!(than && than.thu));
    return json({ ok: true, ...kq });
  } catch (e) {
    return loi(500, "loi_he_thong", String(e && e.message || e).slice(0, 200));
  }
}
