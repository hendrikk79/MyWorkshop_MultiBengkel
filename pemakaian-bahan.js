// =========================================================
// MYWORKSHOP - INPUT PEMAKAIAN BAHAN
// =========================================================

let materialMaster = [];
let woData = [];
let filteredWO = [];
let currentWO = null;

function pbEl(id) { return document.getElementById(id); }
function pbEsc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
}
function pbMoney(value) {
    return "Rp " + Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
function pbApi(url, options = {}) {
    return fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options })
        .then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success === false) throw new Error(data.message || "Permintaan gagal.");
            return data;
        });
}

function normalizeWO(row) {
    return {
        ...row,
        id: row.id ?? row.wo_id,
        material_usage: Array.isArray(row.material_usage) ? row.material_usage : []
    };
}

async function loadMaterialUsage() {
    try {
        const result = await pbApi("/api/pemakaian-bahan");
        materialMaster = Array.isArray(result.master) ? result.master : [];
        woData = Array.isArray(result.data) ? result.data.map(normalizeWO) : [];
    } catch (error) {
        console.error("LOAD PEMAKAIAN BAHAN ERROR", error);
        materialMaster = materialMaster.length ? materialMaster : defaultMaster();
        woData = [];
        myWorkshopAlert("Gagal mengambil daftar WO.\n\n" + error.message);
    }
    applyWOSearch();
}

function defaultMaster() {
    return [
        {code:"AMPLAS",name:"Amplas",mode:"select",options:["Amplas 80","Amplas 120","Amplas 220","Amplas 320","Amplas 400","Amplas 500","Amplas 1000","Amplas 1500","Amplas 200"]},
        ["DEMPUL","Dempul"],["EFOXY","Efoxy"],["LEM_KERTAS","Lem Kertas"],["THINER_PU","Thiner PU"],["THINER_DESGRESER","Thiner DESGRESER"],["THINER_ND_HG","Thiner ND / HG"],["THINER_EXTRASLOW","Thiner EXTRASLOW"],["VERNIS","Vernis"],["CAT","Cat"],["CAT_HITAM_DOFF","Cat Hitam Doff"],["CAT_HITAM_KILAT","Cat Hitam Kilat"],["COUMPOUND_PUTIH_RUBBING","Coumpound Putih Rubbing"],["COUMPOUND_COKELAT","Coumpound Cokelat"],["MIPA_POLISHING","Mipa Polishing"],["CARLAK_LIQUID","Carlak / Liquid"],["PAD_GLAZE","Pad Glaze"],["ISOLASI","Isolasi"],["KORAN_PLASTIK_CAT","Koran / Pelastik Cat"],["SABUN","Sabun"],["SHAMPO","Shampo"],["WOOL_POLES","Wool Poles"],["BIAYA_SURVEY","Biaya Survey"],["KOMISI_AGENT","Komisi Agent"]
    ].map(x => Array.isArray(x) ? {code:x[0],name:x[1],mode:(x[0].startsWith("BIAYA")||x[0].startsWith("KOMISI"))?"name":"brand"} : x);
}

function applyWOSearch() {
    const q = String(pbEl("searchWO")?.value || "").trim().toLowerCase();
    filteredWO = woData.filter(item => {
        if (!q) return true;
        return [item.wo_number,item.estimate_number,item.customer_name,item.plate_number,item.brand,item.model,item.status]
            .some(v => String(v ?? "").toLowerCase().includes(q));
    });
    renderWO();
}

function renderWO() {
    const body = pbEl("woTableBody");
    if (!body) return;
    if (!filteredWO.length) {
        body.innerHTML = `<tr><td colspan="9" class="pb-empty">Tidak ada WO.</td></tr>`;
        return;
    }
    body.innerHTML = filteredWO.map((item, index) => {
        const car = [item.brand,item.model,item.year].filter(v => String(v ?? "").trim() && String(v).trim() !== "-").join(" / ") || "-";
        const saved = Array.isArray(item.material_usage) && item.material_usage.length > 0;
        const id = pbEsc(item.id);
        return `<tr>
            <td>${index + 1}</td>
            <td><strong>${pbEsc(item.wo_number || "-")}</strong></td>
            <td>${pbEsc(item.estimate_number || "-")}</td>
            <td>${pbEsc(item.customer_name || "-")}</td>
            <td>${pbEsc(item.plate_number || "-")}</td>
            <td>${pbEsc(car)}</td>
            <td><span class="pb-status ${saved ? "done" : ""}">${saved ? "Sudah Input" : pbEsc(item.status || "-")}</span></td>
            <td class="pb-money">${pbMoney(item.material_total || 0)}</td>
            <td><div class="pb-actions"><button type="button" class="btn-primary btn-small" onclick="openMaterialModal('${id}')">${saved ? "Edit Data" : "Input Data"}</button>${saved ? `<button type="button" class="btn-secondary btn-small" onclick="printMaterial('${id}')">🖨 Print</button>` : ""}</div></td>
        </tr>`;
    }).join("");
}

function renderMaterialRows(item) {
    const savedMap = new Map((item.material_usage || []).map(x => [String(x.material_code), x]));
    const body = pbEl("materialRows");
    body.innerHTML = materialMaster.map((m, index) => {
        const saved = savedMap.get(m.code) || {};
        const defaultAgentName = m.code === "KOMISI_AGENT" ? String(currentWO?.agent || "").trim() : "";
        const mode = m.mode || "brand";
        const qtyFixed = mode === "name";
        let middle = "";
        if (mode === "select") {
            const options = (m.options || []).map(option => `<option value="${pbEsc(option)}" ${String(saved.brand_name || "") === String(option) ? "selected" : ""}>${pbEsc(option)}</option>`).join("");
            middle = `<select data-field="brand_name" data-code="${pbEsc(m.code)}"><option value="">Pilih amplas</option>${options}</select>`;
        } else {
            middle = `<input type="text" data-field="brand_name" data-code="${pbEsc(m.code)}" value="${pbEsc(saved.brand_name || defaultAgentName)}" placeholder="${qtyFixed ? "Input nama" : "Input merek"}">`;
        }
        return `<tr data-material-row="${pbEsc(m.code)}">
            <td>${index + 1}</td>
            <td><strong>${pbEsc(m.name)}</strong></td>
            <td>${middle}</td>
            <td>${qtyFixed ? `<input class="pb-number" type="number" value="1" readonly>` : `<input class="pb-number" type="number" min="1" step="0.01" data-field="quantity" data-code="${pbEsc(m.code)}" value="${saved.quantity != null && saved.quantity !== "" ? pbEsc(saved.quantity) : ""}" placeholder="Minimal 1">`}</td>
            <td><input type="number" min="0" step="0.01" data-field="unit_price" data-code="${pbEsc(m.code)}" value="${saved.unit_price != null && saved.unit_price !== "" ? pbEsc(saved.unit_price) : ""}" placeholder="0"></td>
            <td class="pb-total" data-total="${pbEsc(m.code)}">${pbMoney(saved.total || 0)}</td>
        </tr>`;
    }).join("");
    body.querySelectorAll("input,select").forEach(input => input.addEventListener("input", recalculateMaterialTotal));
    body.querySelectorAll("input,select").forEach(input => input.addEventListener("change", recalculateMaterialTotal));
    recalculateMaterialTotal();
}

function getFormItems(validate = false) {
    const items = [];
    const errors = [];
    materialMaster.forEach(m => {
        const row = document.querySelector(`[data-material-row="${CSS.escape(m.code)}"]`);
        if (!row) return;
        const brand = String(row.querySelector('[data-field="brand_name"]')?.value || "").trim();
        const qtyInput = row.querySelector('[data-field="quantity"]');
        const quantity = m.mode === "name" ? 1 : Number(qtyInput?.value);
        const priceValue = row.querySelector('[data-field="unit_price"]')?.value;
        const unitPrice = priceValue === "" ? 0 : Number(priceValue);
        const hasInput = Boolean(brand) || priceValue !== "" || (m.mode !== "name" && String(qtyInput?.value || "").trim() !== "");
        if (!hasInput) return;
        if (m.mode === "select" && !brand) errors.push(`${m.name}: pilihan wajib diisi.`);
        if (m.mode !== "name" && (!Number.isFinite(quantity) || quantity < 1)) errors.push(`${m.name}: Qty minimal 1.`);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push(`${m.name}: Harga tidak valid.`);
        if (m.mode === "select" && !(m.options || []).includes(brand)) errors.push(`${m.name}: pilihan tidak valid.`);
        items.push({material_code:m.code,brand_name:brand,quantity:m.mode === "name" ? 1 : quantity,unit_price:unitPrice});
    });
    return {items, errors};
}

function recalculateMaterialTotal() {
    let grand = 0;
    materialMaster.forEach(m => {
        const row = document.querySelector(`[data-material-row="${CSS.escape(m.code)}"]`);
        if (!row) return;
        const qty = m.mode === "name" ? 1 : Number(row.querySelector('[data-field="quantity"]')?.value || 0);
        const price = Number(row.querySelector('[data-field="unit_price"]')?.value || 0);
        const total = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
        grand += total;
        const cell = row.querySelector(`[data-total="${CSS.escape(m.code)}"]`);
        if (cell) cell.textContent = pbMoney(total);
    });
    if (pbEl("grandTotal")) pbEl("grandTotal").textContent = pbMoney(grand);
}

function openMaterialModal(id) {
    currentWO = woData.find(x => String(x.id) === String(id));
    if (!currentWO) return;
    pbEl("formWONumber").textContent = currentWO.wo_number || "-";
    pbEl("formEstimateNumber").textContent = currentWO.estimate_number || "-";
    pbEl("formCustomer").textContent = currentWO.customer_name || "-";
    pbEl("formPlate").textContent = currentWO.plate_number || "-";
    renderMaterialRows(currentWO);
    pbEl("materialModal").classList.add("show");
}

function closeMaterialModal() {
    pbEl("materialModal")?.classList.remove("show");
    currentWO = null;
}

async function saveMaterialUsage(event) {
    event.preventDefault();
    if (!currentWO) return;
    const {items, errors} = getFormItems(true);
    if (!items.length) { myWorkshopAlert("Belum ada bahan yang diinput. Isi Qty minimal 1 untuk bahan yang akan dicatat."); return; }
    if (errors.length) { myWorkshopAlert(errors.join("\n")); return; }
    let user = null;
    try { user = JSON.parse(localStorage.getItem("myworkshop_user") || "null"); } catch (_) {}
    try {
        await pbApi(`/api/pemakaian-bahan/${encodeURIComponent(currentWO.id)}`, {
            method:"POST",
            body:JSON.stringify({items, created_by:Number(user?.id || user?.user_id || 0) || null})
        });
        myWorkshopAlert("Pemakaian bahan berhasil disimpan.");
        closeMaterialModal();
        await loadMaterialUsage();
    } catch (error) {
        myWorkshopAlert("Gagal menyimpan pemakaian bahan.\n\n" + error.message);
    }
}

function printMaterial(id) {
    const item = woData.find(x => String(x.id) === String(id));
    if (!item || !item.material_usage?.length) { myWorkshopAlert("Belum ada data pemakaian bahan untuk WO ini."); return; }
    printMaterialData(item, item.material_usage);
}

function printCurrentMaterial() {
    if (!currentWO) return;
    const {items, errors} = getFormItems(false);
    if (!items.length) { myWorkshopAlert("Belum ada bahan yang diinput. Isi Qty minimal 1 untuk bahan yang akan diprint."); return; }
    if (errors.length) { myWorkshopAlert(errors.join("\n")); return; }
    const rows = items.map(x => ({...x, material_name:(materialMaster.find(m => m.code === x.material_code)?.name || x.material_code), total:x.quantity*x.unit_price}));
    printMaterialData(currentWO, rows, true);
}

async function printMaterialData(item, usage, current = false) {
    const rows = usage.map((x,i) => `<tr><td>${i+1}</td><td>${pbEsc(x.material_name || materialMaster.find(m=>m.code===x.material_code)?.name || "-")}</td><td>${pbEsc(x.brand_name || "-")}</td><td class="num">${Number(x.quantity || 0).toLocaleString("id-ID",{maximumFractionDigits:2})}</td><td class="num">${pbMoney(x.unit_price)}</td><td class="num">${pbMoney(x.total ?? Number(x.quantity||0)*Number(x.unit_price||0))}</td></tr>`).join("");
    const grand = usage.reduce((sum,x)=>sum+Number(x.total ?? Number(x.quantity||0)*Number(x.unit_price||0)),0);
    const date = new Date().toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"});
    const workshopHeader = await getWorkshopPrintHeader();
    const win = window.open("","_blank","width=1000,height=750");
    if (!win) { myWorkshopAlert("Popup print diblokir browser. Silakan izinkan popup untuk MyWorkshop."); return; }
    win.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title><style>body{font-family:Arial,sans-serif;margin:30px;color:#111}h1{font-size:20px;margin:0 0 5px}.sub{font-size:12px;color:#666;margin-bottom:20px}.info{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:20px}.box{border:1px solid #ddd;padding:9px}.box span{display:block;font-size:10px;color:#666;margin-bottom:3px}.box strong{font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;font-size:11px}th{background:#f3f4f6;text-align:left}.num{text-align:right}.grand{text-align:right;font-size:14px;font-weight:800;margin-top:14px}.sign{margin-top:65px;width:250px}.line{border-top:1px solid #111;margin-top:55px;padding-top:6px}@media print{body{margin:15mm}}</style></head><body>${workshopHeader}<h1>LAPORAN PEMAKAIAN BAHAN</h1><div class="sub">${current ? "Preview input" : "Data tersimpan"} — ${pbEsc(date)}</div><div class="info"><div class="box"><span>No. WO</span><strong>${pbEsc(item.wo_number || "-")}</strong></div><div class="box"><span>No. Estimasi</span><strong>${pbEsc(item.estimate_number || "-")}</strong></div><div class="box"><span>Customer</span><strong>${pbEsc(item.customer_name || "-")}</strong></div><div class="box"><span>No. Polisi</span><strong>${pbEsc(item.plate_number || "-")}</strong></div></div><table><thead><tr><th>No</th><th>Bahan</th><th>Merek / Pilihan / Nama</th><th>Qty</th><th>Harga</th><th>Jumlah</th></tr></thead><tbody>${rows}</tbody></table><div class="grand">Total Pemakaian Bahan: ${pbMoney(grand)}</div><script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)};<\/script></body></html>`);
    win.document.close();
}

function initMaterialUsage() {
    if (pbEl("currentDate")) pbEl("currentDate").textContent = new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    pbEl("searchWO")?.addEventListener("input", applyWOSearch);
    pbEl("materialForm")?.addEventListener("submit", saveMaterialUsage);
    pbEl("materialModal")?.addEventListener("click", e => { if (e.target === pbEl("materialModal")) closeMaterialModal(); });
    loadMaterialUsage();
}

document.addEventListener("DOMContentLoaded", initMaterialUsage, {once:true});
window.openMaterialModal = openMaterialModal;
window.closeMaterialModal = closeMaterialModal;
window.printMaterial = printMaterial;
window.printCurrentMaterial = printCurrentMaterial;
