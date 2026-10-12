
// Cache browser wajib dipisahkan berdasarkan bengkel aktif. Data transaksi utama tetap berasal dari API/Central Storage.
function myWorkshopScopedStorageKey(key) {
    try {
        const user = JSON.parse(localStorage.getItem("myworkshop_user") || "null") || {};
        const wid = Number(user?.workshop_id || 0);
        return wid > 0 ? `${String(key)}__workshop_${wid}` : String(key);
    } catch (_) {
        return String(key);
    }
}
// ==========================================================
// MYWORKSHOP - WORK ORDER
// ==========================================================
// WO selalu dibuat dari Estimasi.
// Sumber Estimasi: API /api/estimasi, dengan fallback ke
// localStorage myworkshop_estimasi jika API kosong.
// Harga TIDAK ditampilkan di WO.
// ==========================================================

let woData = [];
let estimasiData = [];
let editingWOId = null;
let editingWOOriginal = null;
let currentWOspareparts = [];
let usingLocalStorage = false;

const WO_STORAGE_KEY = myWorkshopScopedStorageKey("myworkshop_wo");
const ESTIMASI_STORAGE_KEY = myWorkshopScopedStorageKey("myworkshop_estimasi");

function titleCaseUserName(value) {
    const text = String(value ?? "").trim();
    if (!text || text === "-") return "-";
    return text.split(/\s+/).map(word =>
        word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""
    ).join(" ");
}

function getCurrentUser() {
    try {
        const raw = localStorage.getItem("myworkshop_user");
        const user = JSON.parse(raw || "null") || {};
        return user;
    } catch (_) {
        return {};
    }
}

function isCurrentManagerMaster() {
    const u = getCurrentUser();
    const role = u?.role?.code ?? u?.role?.name ?? u?.role_code ?? u?.role_name ?? u?.role;
    return String(role || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") === "MANAGER MASTER";
}

function getCurrentUserName() {
    const u = getCurrentUser();
    return titleCaseUserName(
        u.full_name ?? u.fullName ?? u.name ?? u.nama ?? u.nama_user ?? u.username ?? u.user_name ?? "-"
    );
}

function getCurrentUserId() {
    const u = getCurrentUser();
    const id = Number(u.id ?? u.user_id ?? u.userId ?? 0);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function getCreatedBy(item) {
    // USER pada daftar WO selalu berasal dari data pembuat WO yang tersimpan.
    // Tidak pernah menggunakan user yang sedang membuka halaman sebagai pengganti.
    const savedName = item?.created_by_name ?? item?.createdByName ?? item?.creator_name ?? item?.creatorName;
    if (savedName !== null && savedName !== undefined && String(savedName).trim() !== "") {
        return titleCaseUserName(savedName);
    }

    const savedUsername = item?.created_by_username ?? item?.createdByUsername;
    if (savedUsername !== null && savedUsername !== undefined && String(savedUsername).trim() !== "") {
        return titleCaseUserName(savedUsername);
    }

    return "-";
}

function el(id) { return document.getElementById(id); }

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function apiRequest(url, options = {}) {
    return fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    }).then(async response => {
        let data = {};
        try { data = await response.json(); } catch (_) {}
        if (!response.ok) {
            throw new Error(data.message || data.error || `HTTP ${response.status}`);
        }
        return data;
    });
}

function formatDate(value) {
    if (!value) return "-";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

function formatDateOnly(value) {
    if (!value) return "-";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric"
    });
}

function todayInput() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getId(item) {
    return String(item?.id ?? item?.estimate_id ?? item?.estimasiId ?? "");
}

function getEstimateNumber(item) {
    return String(item?.estimate_number ?? item?.estimateNumber ?? item?.number ?? item?.noEstimasi ?? "");
}

function getCustomer(item) {
    return String(item?.customer_name ?? item?.customerName ?? item?.customer ?? "");
}

function getPlate(item) {
    return String(item?.plate_number ?? item?.plateNumber ?? item?.plate ?? "");
}

function getBrand(item) {
    return String(item?.brand ?? item?.vehicleBrand ?? "");
}

function getModel(item) {
    return String(item?.model ?? item?.type ?? item?.vehicleModel ?? "");
}

function getYear(item) {
    return String(item?.year ?? item?.vehicleYear ?? "");
}

function getColor(item) {
    return String(item?.color ?? item?.vehicleColor ?? "");
}

function getVIN(item) {
    return String(item?.vin_number ?? item?.vinNumber ?? item?.vin ?? item?.noRangka ?? "");
}

function getEngine(item) {
    return String(item?.engine_number ?? item?.engineNumber ?? item?.engine ?? item?.noMesin ?? "");
}

function getInsurer(item) {
    return String(item?.insurer_alias ?? item?.insurerAlias ?? item?.insurer_name ?? item?.insurerName ?? item?.insurer ?? "");
}

function getCustomerCode(item) {
    return String(item?.customer_code ?? item?.customerCode ?? "");
}

function loadLocalEstimasi() {
    try {
        const raw = localStorage.getItem(ESTIMASI_STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("LOCAL ESTIMASI ERROR", e);
        return [];
    }
}

function loadLocalWO() {
    try {
        const raw = localStorage.getItem(WO_STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("LOCAL WO ERROR", e);
        return [];
    }
}

function saveLocalWO() {
    localStorage.setItem(WO_STORAGE_KEY, JSON.stringify(woData));
}

function ensureLocalHistory(item) {
    if (Array.isArray(item.process_history) && item.process_history.length) return item.process_history;
    const history = [];
    const add = (status, value, note = null, cycle_no = 1) => {
        if (value) history.push({ id: `local-${status}-${Date.now()}-${history.length}`, cycle_no, status, note, changed_at: value });
    };
    add("CHECK IN", item.check_in_at);
    add("BONGKAR", item.pengerjaan_at);
    add("DEMPUL", item.dempul_at);
    add("CAT", item.cat_at);
    add("FINISHING", item.finishing_at);
    add("SELESAI", item.selesai_at);
    add("CHECK OUT", item.check_out_at);
    item.process_history = history;
    return history;
}

function addLocalHistory(item, status, changedAt, note = null, cycleNo = null) {
    const history = ensureLocalHistory(item);
    const cycle = cycleNo || Math.max(1, ...history.map(x => Number(x.cycle_no || 1)));
    history.push({
        id: `local-${status}-${Date.now()}-${history.length}`,
        cycle_no: cycle,
        status,
        note: note || null,
        changed_at: changedAt || new Date().toISOString()
    });
    item.process_history = history;
}

async function loadEstimasiData() {
    try {
        const result = await apiRequest("/api/estimasi");
        estimasiData = Array.isArray(result.data) ? result.data : [];
        usingLocalStorage = false;
    } catch (e) {
        console.error("Gagal mengambil Estimasi dari database pusat:", e);
        estimasiData = [];
        usingLocalStorage = false;
    }
}
async function loadWO() {
    try {
        const result = await apiRequest("/api/wo");
        woData = Array.isArray(result.data) ? result.data : [];
    } catch (e) {
        console.error("Gagal mengambil WO dari database pusat:", e);
        woData = [];
    }
    usingLocalStorage = false;
    renderWOList();
}
function findEstimasi(id) {
    return estimasiData.find(item => getId(item) === String(id)) || null;
}

function getEstimasiSearchText(item) {
    return [
        getEstimateNumber(item),
        getCustomer(item),
        getCustomerCode(item),
        getPlate(item),
        getBrand(item),
        getModel(item)
    ].join(" ").toLowerCase();
}

function loadEstimasiSelect(selectedId = "", keyword = "") {
    const hidden = el("woEstimasi");
    const search = el("woEstimasiSearch");
    const results = el("woEstimasiResults");
    if (!hidden || !results) return;

    const used = new Set(
        woData
            .filter(w => getWOId(w) !== String(editingWOId))
            .map(w => String(w.estimate_id ?? w.estimasiId ?? w.estimateId ?? ""))
    );

    const q = String(keyword || search?.value || "").trim().toLowerCase();
    const filtered = estimasiData.filter(item => {
        const id = getId(item);
        // Estimasi yang sudah terhubung ke WO tidak ditawarkan untuk pembuatan WO baru.
        if (used.has(id)) return false;
        if (!q) return true;
        return getEstimasiSearchText(item).includes(q);
    });

    results.innerHTML = "";

    if (!estimasiData.length) {
        results.innerHTML = '<div class="wo-estimate-empty">Belum ada Estimasi.</div>';
        results.classList.add("show");
        return;
    }

    if (!filtered.length) {
        results.innerHTML = '<div class="wo-estimate-empty">Estimasi tidak ditemukan.</div>';
        results.classList.add("show");
        return;
    }

    filtered.forEach(item => {
        const id = getId(item);
        if (!id) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "wo-estimate-result";
        if (id === String(selectedId || hidden.value || "")) {
            button.classList.add("selected");
        }

        const number = getEstimateNumber(item) || "Estimasi";
        const customer = getCustomer(item) || "-";
        const plate = getPlate(item) || "-";
        const disabled = used.has(id) && id !== String(selectedId || hidden.value || "");

        button.innerHTML = `<strong>${escapeHTML(number)}</strong><span>${escapeHTML(customer)} &nbsp;•&nbsp; ${escapeHTML(plate)}${disabled ? " &nbsp;•&nbsp; Sudah memiliki WO" : ""}</span>`;
        button.disabled = disabled;

        button.addEventListener("click", () => {
            hidden.value = id;
            if (search) search.value = `${number} — ${customer} — ${plate}`;
            results.classList.remove("show");
            handleEstimasiChange();
        });

        results.appendChild(button);
    });

    results.classList.add("show");
}

function openEstimasiPicker() {
    if (editingWOId) return;
    loadEstimasiSelect(el("woEstimasi")?.value || "", "");
}

function searchEstimasiPicker() {
    if (editingWOId) return;
    loadEstimasiSelect(el("woEstimasi")?.value || "", el("woEstimasiSearch")?.value || "");
}

function normalizeItems(estimate) {
    return {
        spareparts: estimate?.spareparts || estimate?.sparepart || estimate?.items_sparepart || [],
        jasa: estimate?.jasa || estimate?.services || estimate?.estimate_services || [],
        jasaLain: estimate?.jasa_lain || estimate?.jasaLain || estimate?.otherServices || estimate?.estimate_other_services || []
    };
}

async function getEstimateDetail(id) {
    const local = findEstimasi(id);
    if (usingLocalStorage && local) return local;

    try {
        const result = await apiRequest(`/api/estimasi/${encodeURIComponent(id)}`);
        return result.data || local;
    } catch (e) {
        if (local) return local;
        throw e;
    }
}

function renderVehicleInfo(data) {
    const box = el("woVehicleInfo");
    if (!box) return;

    if (!data) {
        box.innerHTML = '<div class="wo-empty">Pilih Estimasi.</div>';
        return;
    }

    const rows = [
        ["Kode Customer", getCustomerCode(data)],
        ["Nama Customer", getCustomer(data)],
        ["Asuransi", getInsurer(data) || "-"],
        ["No. Polisi", getPlate(data)],
        ["Merk Mobil", getBrand(data)],
        ["Type Mobil", getModel(data)],
        ["Tahun", getYear(data)],
        ["Warna", getColor(data)],
        ["No. Rangka", getVIN(data)],
        ["No. Mesin", getEngine(data)]
    ];

    box.innerHTML = rows.map(([label, value]) => `
        <div class="wo-info-item">
            <div class="wo-label">${escapeHTML(label)}</div>
            <strong>${escapeHTML(value || "-")}</strong>
        </div>
    `).join("");
}

function renderSpareparts(items) {
    const body = el("woSparepartBody");
    if (!body) return;

    currentWOspareparts = (Array.isArray(items) ? items : []).map(item => ({
        ...item,
        supply_bengkel: item.supply_bengkel ?? item.supplyBengkel ?? item.supply ?? "BENGKEL"
    }));

    if (!currentWOspareparts.length) {
        body.innerHTML = '<tr><td colspan="6" class="wo-empty">Tidak ada Sparepart / Material pada Estimasi.</td></tr>';
        return;
    }

    body.innerHTML = currentWOspareparts.map((item, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHTML(item.part_name ?? item.partName ?? item.name ?? item.nama ?? "-")}</td>
            <td>
                <select class="wo-supply-select" onchange="setSparepartSupply(${i}, this.value)">
                    <option value="SUPPLY" ${String(item.supply_bengkel).toUpperCase() === "SUPPLY" ? "selected" : ""}>SUPPLY</option>
                    <option value="BENGKEL" ${String(item.supply_bengkel).toUpperCase() !== "SUPPLY" ? "selected" : ""}>BENGKEL</option>
                </select>
            </td>
            <td>${escapeHTML(item.part_number ?? item.partNumber ?? item.sku ?? "-")}</td>
            <td>${escapeHTML(item.quantity ?? item.qty ?? "-")}</td>
            <td>${escapeHTML(item.unit ?? "PCS")}</td>
        </tr>
    `).join("");
}

async function setSparepartSupply(index, value) {
    if (!currentWOspareparts[index]) return;
    const normalized = String(value || "BENGKEL").trim().toUpperCase() === "SUPPLY" ? "SUPPLY" : "BENGKEL";
    currentWOspareparts[index].supply_bengkel = normalized;

    // WO yang sudah ada: simpan pilihan langsung saat dropdown diubah.
    if (!editingWOId || usingLocalStorage) return;

    try {
        await apiRequest(`/api/wo/${encodeURIComponent(editingWOId)}`, {
            method: "PUT",
            body: JSON.stringify({
                kilometer: el("woKilometer")?.value ?? "",
                target_date: el("woTargetDate")?.value ?? "",
                notes: el("woNotes")?.value ?? "",
                spareparts: currentWOspareparts
            })
        });
    } catch (error) {
        console.error("Gagal menyimpan pilihan BENGKEL/SUPPLY:", error);
        if (typeof myWorkshopAlert === "function") {
            await myWorkshopAlert("Pilihan BENGKEL/SUPPLY gagal disimpan.\n\n" + (error?.message || "Gagal menyimpan data."));
        }
    }
}

function renderJasa(items) {
    const body = el("woJasaBody");
    if (!body) return;

    if (!Array.isArray(items) || !items.length) {
        body.innerHTML = '<tr><td colspan="5" class="wo-empty">Tidak ada Jasa Perbaikan / Pengecatan pada Estimasi.</td></tr>';
        return;
    }

    body.innerHTML = items.map((item, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHTML(item.panel_name ?? item.panelName ?? item.panel ?? "-")}</td>
            <td>${escapeHTML(item.service_type ?? item.serviceType ?? item.jenis ?? "-")}</td>
            <td>${escapeHTML(item.quantity ?? item.qty ?? "-")}</td>
            <td>${escapeHTML(item.unit ?? "JOB")}</td>
        </tr>
    `).join("");
}

function renderJasaLain(items) {
    const body = el("woJasaLainBody");
    if (!body) return;

    if (!Array.isArray(items) || !items.length) {
        body.innerHTML = '<tr><td colspan="4" class="wo-empty">Tidak ada Jasa Lain-lain pada Estimasi.</td></tr>';
        return;
    }

    body.innerHTML = items.map((item, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHTML(item.service_name ?? item.serviceName ?? item.name ?? item.nama ?? "-")}</td>
            <td>${escapeHTML(item.quantity ?? item.qty ?? "-")}</td>
            <td>${escapeHTML(item.unit ?? "JOB")}</td>
        </tr>
    `).join("");
}

async function handleEstimasiChange() {
    const id = el("woEstimasi")?.value || "";

    if (!id) {
        renderVehicleInfo(null);
        renderSpareparts([]);
        renderJasa([]);
        renderJasaLain([]);
        return;
    }

    try {
        const data = await getEstimateDetail(id);
        const items = normalizeItems(data);
        renderVehicleInfo(data);
        renderSpareparts(items.spareparts);
        renderJasa(items.jasa);
        renderJasaLain(items.jasaLain);
    } catch (e) {
        myWorkshopAlert("Gagal mengambil detail Estimasi.\n\n" + e.message);
    }
}

function getWOId(item) {
    return String(item?.id ?? item?.wo_id ?? item?.woId ?? "");
}

function getWOEstimateId(item) {
    return String(item?.estimate_id ?? item?.estimasiId ?? item?.estimateId ?? "");
}

function getWOStatus(item) {
    const raw = String(item?.status || "CHECK IN").toUpperCase();
    // Kompatibilitas data lama: PENGERJAAN dianggap sudah masuk tahap BONGKAR.
    if (raw === "PENGERJAAN") return "BONGKAR";
    return raw;
}

function generateLocalWONumber() {
    const year = new Date().getFullYear();
    let max = 0;
    woData.forEach(w => {
        const m = String(w.wo_number ?? w.noWO ?? w.number ?? "").match(new RegExp(`^WO-${year}-(\\d+)$`));
        if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return `WO-${year}-${String(max + 1).padStart(4, "0")}`;
}

function getSparepartStatus(item) {
    const list = Array.isArray(item?.sparepart_status) ? item.sparepart_status : [];
    const summary = item?.sparepart_summary || {};
    const total = Number(summary.total ?? list.length ?? 0);
    const arrived = Number(summary.arrived ?? list.filter(x => x?.arrived && !x?.returned).length ?? 0);
    const returned = Number(summary.returned ?? list.filter(x => x?.returned).length ?? 0);
    const remaining = Number(summary.remaining ?? Math.max(total - arrived, 0));
    return { list, total, arrived, returned, remaining };
}

function sparepartStatusLabel(item) {
    const s = getSparepartStatus(item);
    if (!s.total) return `<span class="wo-sparepart-badge neutral">Tidak ada</span>`;
    return s.remaining === 0
        ? `<span class="wo-sparepart-badge done">LENGKAP</span>`
        : `<span class="wo-sparepart-badge pending">BELUM LENGKAP<br><small>${s.arrived}/${s.total} datang</small></span>`;
}

async function openSparepartInfo(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;
    const s = getSparepartStatus(item);
    const modal = el("sparepartInfoModal");
    const title = el("sparepartInfoTitle");
    const summary = el("sparepartInfoSummary");
    const body = el("sparepartInfoBody");
    if (!modal || !summary || !body) return;

    if (title) title.textContent = `Informasi Sparepart - ${item.wo_number ?? item.noWO ?? "WO"}`;
    summary.innerHTML = s.total
        ? `<div class="wo-sparepart-summary ${s.remaining === 0 ? "complete" : "incomplete"}">
             <strong>${s.remaining === 0 ? "SPAREPART LENGKAP" : "SPAREPART BELUM LENGKAP"}</strong>
             <span>Sudah datang: <b>${s.arrived}</b> &nbsp;|&nbsp; RETURN: <b>${s.returned}</b> &nbsp;|&nbsp; Belum datang: <b>${s.remaining}</b> &nbsp;|&nbsp; Total: <b>${s.total}</b></span>
           </div>`
        : `<div class="wo-sparepart-summary complete"><strong>TIDAK ADA SPAREPART</strong><span>WO ini tidak memiliki data sparepart.</span></div>`;

    const wid = getWOId(item);
    let poItems = [];
    let supplyArrivals = [];
    try {
        const [poRes, supplyRes] = await Promise.all([
            fetch('/api/storage/purchase_orders', { cache: 'no-store' }).then(r => r.ok ? r.json() : ({})),
            fetch('/api/storage/supply_arrivals', { cache: 'no-store' }).then(r => r.ok ? r.json() : ({}))
        ]);
        const pos = Array.isArray(poRes?.data) ? poRes.data : [];
        const po = pos.find(x => String(x?.wo_id ?? x?.woId ?? x?.work_order_id ?? '') === String(wid));
        poItems = Array.isArray(po?.items) ? po.items : [];
        supplyArrivals = (Array.isArray(supplyRes?.data) ? supplyRes.data : []).filter(x =>
            String(x?.wo_id ?? x?.woId ?? x?.work_order_id ?? '') === String(wid)
        );
    } catch (e) {
        console.warn('Tidak dapat memuat data foto penerimaan sparepart', e);
    }

    const norm = value => String(value ?? '').trim().toLowerCase();
    const itemId = sp => sp?.id ?? sp?.estimate_sparepart_id ?? sp?.item_id ?? sp?.itemId ?? null;
    const itemName = sp => sp?.part_name ?? sp?.partName ?? sp?.name ?? sp?.part ?? '';
    const itemSku = sp => sp?.part_number ?? sp?.partNumber ?? sp?.sku ?? sp?.no_part ?? '';
    const samePart = (a, b, index) => {
        const aid = itemId(a), bid = itemId(b);
        if (aid != null && bid != null && String(aid) === String(bid)) return true;
        const aSeq = a?.sequence ?? a?.estimate_sparepart_sequence;
        const bSeq = b?.sequence ?? b?.estimate_sparepart_sequence;
        if (aSeq != null && bSeq != null && String(aSeq) === String(bSeq)) return true;
        if (norm(itemSku(a)) && norm(itemSku(a)) === norm(itemSku(b))) return true;
        if (norm(itemName(a)) && norm(itemName(a)) === norm(itemName(b)) &&
            Number(a?.item_index ?? a?.itemIndex ?? index) === Number(b?.item_index ?? b?.itemIndex ?? index)) return true;
        return false;
    };

    body.innerHTML = s.list.length ? s.list.map((sp, index) => {
        const returned = !!sp?.returned;
        const arrived = !returned && !!sp?.arrived;
        const name = itemName(sp) || '-';
        const type = String(sp?.supply_bengkel ?? sp?.supplyBengkel ?? sp?.supply ?? 'BENGKEL').toUpperCase();
        const isSupply = type.includes('SUPPLY');
        const qty = sp?.quantity ?? sp?.qty ?? '-';
        const date = !returned && sp?.arrival_date ? formatDateOnly(sp.arrival_date) : '-';
        const supplier = sp?.supplier || '-';
        const note = returned
            ? `RETURN${sp?.return_reason ? `: ${sp.return_reason}` : ''}`
            : (sp?.note || sp?.arrival_note || '-');

        // Foto dicari berdasarkan item transaksi yang benar, bukan posisi baris semata.
        // photo_key yang tersimpan pada transaksi menjadi sumber utama, termasuk siklus penerimaan ulang.
        let sourceRecord = null;
        if (isSupply) {
            sourceRecord = supplyArrivals.find(entry => samePart(sp, entry, index)) ||
                supplyArrivals.find(entry => Number(entry?.item_index ?? entry?.itemIndex) === index) || null;
        } else {
            sourceRecord = poItems.find(entry => samePart(sp, entry, index)) ||
                poItems.find(entry => Number(entry?.estimate_sparepart_sequence) === Number(sp?.sequence)) || null;
        }
        let photoKey = sp?.photo_key || sourceRecord?.photo_key || '';
        if (!photoKey) {
            const id = itemId(sp) ?? sourceRecord?.item_id ?? sourceRecord?.estimate_sparepart_id ?? sp?.sequence ?? index;
            const history = sourceRecord?.return_history ?? sourceRecord?.replacement_history ?? sp?.return_history ?? sp?.replacement_history;
            const cycle = 1 + (Array.isArray(history) ? history.length : 0);
            photoKey = `${isSupply ? 'supply' : 'bengkel'}:${wid}:${id}:cycle${cycle}`;
        }
        const photoPrefix = photoKey.replace(/cycle\d+$/, '');
        return `<tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHTML(name)}</strong><br><small>${escapeHTML(itemSku(sp) || '-')}</small></td>
            <td>${escapeHTML(type)}</td>
            <td>${escapeHTML(qty)}</td>
            <td>${returned ? `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:11px">RETURN</span>` : (arrived ? `<span class="wo-arrival-done">SUDAH DATANG</span>` : `<span class="wo-arrival-pending">BELUM DATANG</span>`)}</td>
            <td>${escapeHTML(date)}</td>
            <td>${escapeHTML(supplier)}</td>
            <td>${escapeHTML(note)}</td>
            <td><button type="button" class="btn-secondary btn-small" onclick="MyWorkshopReceiptPhotos.openHistory('${escapeHTML(photoPrefix)}','Riwayat Foto ${escapeHTML(name)}')">📷 Lihat / Download Foto</button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="9" class="wo-empty">Tidak ada data sparepart.</td></tr>`;

    modal.classList.add("show");
}

function closeSparepartInfo() {
    el("sparepartInfoModal")?.classList.remove("show");
}

function renderWOList() {
    const body = el("woTableBody");
    if (!body) return;

    const keyword = String(el("searchWO")?.value || "").trim().toLowerCase();

    const completedPage = /(?:^|\/)wo-selesai\.html$/i.test(window.location.pathname);
    const sparepartHeader = document.querySelector(".wo-active-only-header");
    if (sparepartHeader) sparepartHeader.style.display = completedPage ? "none" : "";

    const rows = woData.filter(item => {
        const status = getWOStatus(item);

        // WO dengan status CHECK OUT langsung pindah ke halaman WO Selesai.
        // Karena halaman WO dan WO Selesai menggunakan sumber data yang sama,
        // filter dilakukan di frontend agar data lama/API/localStorage konsisten.
        if (completedPage) {
            if (status !== "CHECK OUT") return false;
        } else {
            // Jangan tampilkan WO yang sudah CHECK OUT di daftar WO aktif.
            // WO tersebut hanya dapat diakses kembali melalui Check In Again
            // dari menu WO Selesai.
            if (status === "CHECK OUT") return false;
        }
        const text = [
            item.wo_number, item.noWO, item.number,
            item.estimate_number, item.noEstimasi,
            item.customer_name, item.customerName, item.customer,
            item.plate_number, item.plateNumber, item.plate,
            item.insurer_alias, item.insurerAlias, item.insurer_name,
            item.status
        ].join(" ").toLowerCase();
        return !keyword || text.includes(keyword);
    });

    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="12" class="wo-empty">Belum ada WO.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map((item, index) => {
        const status = getWOStatus(item);
        const id = getWOId(item);
        const target = item.target_date ?? item.targetDate ?? "";

        let workflow = "";
        const next = {
            "CHECK IN": "BONGKAR",
            "BONGKAR": "DEMPUL",
            "DEMPUL": "CAT",
            "CAT": "FINISHING",
            "FINISHING": "SELESAI",
            "SELESAI": "CHECK OUT"
        }[status];
        if (next) {
            const action = next === "CHECK OUT"
                ? `checkOutWO('${escapeHTML(id)}')`
                : `advanceWOStatus('${escapeHTML(id)}','${next}')`;
            workflow = `<button type="button" class="btn-primary btn-small wo-flow-button" onclick="${action}">${next}</button>`;
        }

        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${escapeHTML(item.wo_number ?? item.noWO ?? item.number ?? "-")}</strong></td>
                <td>${escapeHTML(formatDate(item.created_at ?? item.createdAt ?? item.date))}</td>
                <td>${escapeHTML(formatDateOnly(target))}</td>
                ${completedPage ? `<td>${escapeHTML(formatDate(item.check_out_at ?? item.checkOutAt ?? "-"))}</td>` : ""}
                <td>${escapeHTML(getCreatedBy(item))}</td>
                <td>${escapeHTML(item.customer_name ?? item.customerName ?? item.customer ?? "-")}</td>
                <td>${escapeHTML(item.insurer_alias ?? item.insurerAlias ?? item.insurer_name ?? item.insurerName ?? "-")}</td>
                <td>${escapeHTML(item.plate_number ?? item.plateNumber ?? item.plate ?? "-")}</td>
                <td><span class="badge">${escapeHTML(status)}</span></td>
                ${completedPage ? `<td>${item.kuitansi_id ? `<strong>SUDAH DIBUAT</strong> - Rp ${Number(item.kuitansi_nominal || 0).toLocaleString("id-ID")}` : "BELUM DIBUAT"}</td>` : `<td>${sparepartStatusLabel(item)}<br><button type="button" class="btn-secondary btn-small wo-sparepart-info-button" onclick="openSparepartInfo('${escapeHTML(id)}')">Informasi Sparepart</button></td>`}
                <td>
                    <div class="wo-actions">
                        ${completedPage
                            ? `<button type="button" class="btn-secondary btn-small" onclick="openWOCompletedDetail('${escapeHTML(id)}')">Detail</button>
                               <button type="button" class="btn-primary btn-small wo-flow-button" onclick="openCheckInAgainModal('${escapeHTML(id)}')">Check In Again</button>
                               <button type="button" class="btn-secondary btn-small" onclick="openDocumentHistory('WO','${escapeHTML(id)}','${escapeHTML(item.wo_number ?? item.noWO ?? '-') }')">Riwayat</button>`
                            : `<button type="button" class="btn-secondary btn-small" onclick="openWOFromServer('${escapeHTML(id)}')">Detail</button>
                               <button type="button" class="btn-secondary btn-small" onclick="printWO('${escapeHTML(id)}')">Print</button>
                               ${workflow}
                               <button type="button" class="btn-secondary btn-small" onclick="inputProgressNote('${escapeHTML(id)}')">${item.progress_note ? "Ubah Keterangan Progress" : "Input Keterangan Progress"}</button>
                               ${isCurrentManagerMaster() ? `<button type="button" class="btn-danger btn-small" onclick="deleteWO('${escapeHTML(id)}')">Hapus</button>` : ""}
                               <button type="button" class="btn-secondary btn-small" onclick="openDocumentHistory('WO','${escapeHTML(id)}','${escapeHTML(item.wo_number ?? item.noWO ?? '-') }')">Riwayat</button>`}
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function openProgressNoteModal(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;
    el("progressNoteWOId").value = String(id);
    el("progressNoteWONumber").value = String(item.wo_number ?? item.noWO ?? item.number ?? "-");
    el("progressNoteInput").value = String(item.progress_note || item.progressNote || "");
    el("progressNoteModal")?.classList.add("show");
    setTimeout(() => el("progressNoteInput")?.focus(), 50);
}

function closeProgressNoteModal() {
    el("progressNoteModal")?.classList.remove("show");
}

function inputProgressNote(id) {
    openProgressNoteModal(id);
}

async function saveProgressNote() {
    const id = String(el("progressNoteWOId")?.value || "");
    const value = String(el("progressNoteInput")?.value || "").trim();
    if (!id) return;
    if (!value) {
        myWorkshopAlert("Keterangan Progress wajib diisi.");
        el("progressNoteInput")?.focus();
        return;
    }
    const button = el("btnSaveProgressNote");
    if (button) button.disabled = true;
    try {
        if (usingLocalStorage) {
            const idx = woData.findIndex(w => getWOId(w) === id);
            if (idx < 0) return;
            woData[idx].progress_note = value;
            woData[idx].progressNote = value;
            localStorage.setItem("myworkshop_wo", JSON.stringify(woData));
        } else {
            const result = await apiRequest(`/api/wo/${encodeURIComponent(id)}/progress-note`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keterangan: value })
            });
            const idx = woData.findIndex(w => getWOId(w) === id);
            if (idx >= 0) woData[idx] = { ...woData[idx], ...(result.data || {}), progress_note: value, progressNote: value };
        }
        closeProgressNoteModal();
        renderWOList();
        await loadProgressReport();
    } catch (error) {
        myWorkshopAlert(error.message || "Gagal menyimpan Keterangan Progress.");
    } finally {
        if (button) button.disabled = false;
    }
}

function resetForm() {
    editingWOId = null;
    el("woId").value = "";
    el("woNumber").value = usingLocalStorage ? generateLocalWONumber() : "Otomatis saat disimpan";
    el("woDate").value = new Date().toLocaleString("id-ID");
    el("woStatus").value = "CHECK IN";
    el("woTargetDate").value = todayInput();
    el("woKilometer").value = "";
    el("woCheckInAt").value = "-";
    el("woNotes").value = "";
    currentWOspareparts = [];
    el("woEstimasi").value = "";
    el("woEstimasi").disabled = false;
    if (el("woEstimasiSearch")) {
        el("woEstimasiSearch").value = "";
        el("woEstimasiSearch").readOnly = false;
        el("woEstimasiSearch").removeAttribute("aria-readonly");
    }
    el("woModalTitle").textContent = "Buat WO dari Estimasi";
    el("saveWOButton").textContent = "Simpan WO";
    renderVehicleInfo(null);
    renderSpareparts([]);
    renderJasa([]);
    renderJasaLain([]);
    loadEstimasiSelect();
}

function openNewWO() {
    resetForm();
    el("woModal").classList.add("show");
}

async function openWOFromServer(id) {
    const local = woData.find(w => getWOId(w) === String(id));
    if (!local) return;

    editingWOId = String(id);
    editingWOOriginal = null;

    let data = local;
    let detail = null;

    if (!usingLocalStorage) {
        try {
            const result = await apiRequest(`/api/wo/${encodeURIComponent(id)}`);
            detail = result.data;
            data = detail.wo;
        } catch (e) {
            console.warn(e);
        }
    }

    el("woId").value = id;
    el("woNumber").value = data.wo_number ?? data.noWO ?? data.number ?? "";
    el("woDate").value = formatDate(data.created_at ?? data.createdAt ?? data.date);
    el("woStatus").value = getWOStatus(data);
    el("woTargetDate").value = data.target_date ?? data.targetDate ?? "";
    el("woKilometer").value = data.kilometer ?? "";
    el("woCheckInAt").value = data.check_in_at ? formatDate(data.check_in_at) : (data.checkInAt ? formatDate(data.checkInAt) : "-");
    el("woNotes").value = data.notes ?? "";

    const estimateId = getWOEstimateId(data);
    // No. Estimasi adalah relasi permanen WO -> Estimasi. Saat detail dibuka,
    // tampilkan nilai tersimpan dan jangan izinkan picker mengganti relasinya.
    loadEstimasiSelect(estimateId);
    el("woEstimasi").value = estimateId;
    el("woEstimasi").disabled = true;
    const selectedEstimate = findEstimasi(estimateId);
    if (el("woEstimasiSearch")) {
        el("woEstimasiSearch").readOnly = true;
        el("woEstimasiSearch").setAttribute("aria-readonly", "true");
        el("woEstimasiSearch").value = selectedEstimate
            ? `${getEstimateNumber(selectedEstimate)} — ${getCustomer(selectedEstimate) || "-"} — ${getPlate(selectedEstimate) || "-"}`
            : (data.estimate_number ?? data.estimateNumber ?? data.noEstimasi ?? estimateId);
        el("woEstimasiResults")?.classList.remove("show");
    }

    if (detail) {
        editingWOOriginal = cloneDocumentHistoryValue({ wo: data, spareparts: detail.spareparts || [], jasa: detail.jasa || [], jasa_lain: detail.jasa_lain || [] });
        renderVehicleInfo(data);
        renderSpareparts((detail.spareparts || []).map((sp, idx) => ({ ...sp, supply_bengkel: sp.supply_bengkel ?? sp.supplyBengkel ?? sp.supply ?? local.spareparts?.[idx]?.supply_bengkel ?? local.spareparts?.[idx]?.supplyBengkel ?? local.spareparts?.[idx]?.supply ?? "BENGKEL" })));
        renderJasa(detail.jasa || []);
        renderJasaLain(detail.jasa_lain || []);
    } else {
        const estimate = findEstimasi(estimateId);
        if (estimate) {
            const items = normalizeItems(estimate);
            renderVehicleInfo(estimate);
            renderSpareparts(items.spareparts);
            renderJasa(items.jasa);
            renderJasaLain(items.jasaLain);
        }
    }

    el("woModalTitle").textContent = `WO ${el("woNumber").value}`;
    el("saveWOButton").textContent = getWOStatus(data) === "CHECK OUT" ? "Tutup" : "Simpan Perubahan";
    el("woModal").classList.add("show");
}

async function submitWO(event) {
    event.preventDefault();

    const estimateId = el("woEstimasi").value;
    if (!estimateId) {
        myWorkshopAlert("Silakan pilih Estimasi terlebih dahulu.");
        return;
    }

    const estimate = await getEstimateDetail(estimateId);
    const items = normalizeItems(estimate);
    const now = new Date().toISOString();
    const targetDate = el("woTargetDate").value || null;

    if (usingLocalStorage) {
        if (editingWOId) {
            const index = woData.findIndex(w => getWOId(w) === String(editingWOId));
            if (index < 0) return;
            woData[index] = {
                ...woData[index],
                estimate_id: estimateId,
                estimasiId: estimateId,
                noEstimasi: getEstimateNumber(estimate),
                target_date: targetDate,
                customer_name: getCustomer(estimate),
                customerName: getCustomer(estimate),
                customer_code: getCustomerCode(estimate),
                insurer_name: getInsurer(estimate),
                plate_number: getPlate(estimate),
                brand: getBrand(estimate),
                model: getModel(estimate),
                year: getYear(estimate),
                color: getColor(estimate),
                vin_number: getVIN(estimate),
                engine_number: getEngine(estimate),
                spareparts: currentWOspareparts,
                jasa: items.jasa,
                jasa_lain: items.jasaLain,
                kilometer: el("woKilometer").value,
                notes: el("woNotes").value,
                progress_note: woData[index].progress_note || "",
                updatedAt: now
            };
        } else {
            const already = woData.some(w => getWOEstimateId(w) === String(estimateId));
            if (already) {
                myWorkshopAlert("Estimasi tersebut sudah memiliki WO.");
                return;
            }
            woData.unshift({
                id: `LOCAL-${Date.now()}`,
                wo_number: generateLocalWONumber(),
                estimate_id: estimateId,
                estimasiId: estimateId,
                noEstimasi: getEstimateNumber(estimate),
                created_at: now,
                created_by: getCurrentUserId(),
                created_by_name: getCurrentUserName(),
                createdBy: getCurrentUserId(),
                target_date: targetDate,
                status: "CHECK IN",
                kilometer: el("woKilometer").value || "",
                notes: el("woNotes").value || "",
                progress_note: "",
                customer_name: getCustomer(estimate),
                customerName: getCustomer(estimate),
                customer_code: getCustomerCode(estimate),
                insurer_name: getInsurer(estimate),
                plate_number: getPlate(estimate),
                brand: getBrand(estimate),
                model: getModel(estimate),
                year: getYear(estimate),
                color: getColor(estimate),
                vin_number: getVIN(estimate),
                engine_number: getEngine(estimate),
                spareparts: currentWOspareparts,
                jasa: items.jasa,
                jasa_lain: items.jasaLain,
                check_in_at: now,
                pengerjaan_at: "",
                selesai_at: "",
                check_out_at: "",
                process_history: [{ id: `local-checkin-${Date.now()}`, cycle_no: 1, status: "CHECK IN", note: null, changed_at: now }],
                updatedAt: now
            });
        }
        saveLocalWO();
        renderWOList();
        closeWOModal();
        showWOSuccessModal("WO berhasil diperbarui.");
        return;
    }

    const body = {
        estimate_id: Number(estimateId),
        target_date: targetDate,
        kilometer: el("woKilometer").value,
        notes: el("woNotes").value,
        created_by: getCurrentUserId(),
        created_by_name: getCurrentUserName()
    };

    const wasEditingWO = Boolean(editingWOId);
    const historyWOId = editingWOId;
    try {
        if (editingWOId) {
            await apiRequest(`/api/wo/${encodeURIComponent(editingWOId)}`, {
                method: "PUT", body: JSON.stringify({ ...body, spareparts: currentWOspareparts })
            });
        } else {
            await apiRequest("/api/wo", {
                method: "POST", body: JSON.stringify(body)
            });
        }
        if (wasEditingWO && editingWOOriginal) {
            try {
                const detailResult = await apiRequest(`/api/wo/${encodeURIComponent(historyWOId)}`);
                const detailAfter = detailResult?.data;
                if (detailAfter) await recordDocumentRevision("WO", historyWOId, editingWOOriginal, { wo: detailAfter.wo, spareparts: detailAfter.spareparts || [], jasa: detailAfter.jasa || [], jasa_lain: detailAfter.jasa_lain || [] });
            } catch (historyError) { console.warn("Riwayat revisi WO gagal dicatat:", historyError); }
        }
        closeWOModal();
        await loadWO();
        showWOSuccessModal("WO berhasil diperbarui.");
    } catch (e) {
        myWorkshopAlert("Gagal menyimpan WO.\n\n" + e.message);
    }
}

function showWOSuccessModal(message) {
    const old = document.getElementById("woSuccessModal");
    if (old) old.remove();
    const modal = document.createElement("div");
    modal.id = "woSuccessModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;";
    const safeMessage = String(message).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    modal.innerHTML = `<div style="background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);width:min(420px,calc(100% - 32px));padding:30px;text-align:center;"><div style="width:68px;height:68px;border-radius:50%;background:#22c55e;margin:0 auto 15px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(34,197,94,.28);animation:mwSuccessPop .35s ease-out;"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h3 style="margin:0 0 8px;color:#15803d;font-size:20px;">Berhasil</h3><div style="color:#334155;line-height:1.5;white-space:pre-line;">${safeMessage}</div></div>`;
    if (!document.getElementById("mwSuccessPopStyle")) {
        const style = document.createElement("style");
        style.id = "mwSuccessPopStyle";
        style.textContent = "@keyframes mwSuccessPop{0%{transform:scale(.55);opacity:.2}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}";
        document.head.appendChild(style);
    }
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 1500);
  }

function closeWOModal() {
    el("woModal")?.classList.remove("show");
    editingWOId = null;
}

function openKilometerModal(currentValue = "") {
    return new Promise(resolve => {
        const old = document.getElementById("mwKilometerModal");
        if (old) old.remove();
        const modal = document.createElement("div");
        modal.id = "mwKilometerModal";
        modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                <div style="background:#fff;width:min(430px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                    <h3 style="margin:0 0 8px;color:#14213d;">Kilometer saat Check In</h3>
                    <p style="margin:0 0 14px;line-height:1.5;">Masukkan kilometer kendaraan sebelum proses menjadi BONGKAR.</p>
                    <input type="number" min="0" step="1" data-kilometer value="${escapeHTML(currentValue)}" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:7px;margin-bottom:18px;">
                    <div style="display:flex;justify-content:flex-end;gap:10px;">
                        <button type="button" data-cancel style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#fff;color:#14213d;font-weight:700;cursor:pointer;">Batal</button>
                        <button type="button" data-ok style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#14213d;color:#fff;font-weight:700;cursor:pointer;">Simpan</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const input = modal.querySelector("[data-kilometer]");
        const close = value => { modal.remove(); resolve(value); };
        modal.querySelector("[data-cancel]").onclick = () => close(null);
        modal.querySelector("[data-ok]").onclick = () => {
            const value = String(input.value || "").trim();
            if (!value) { input.focus(); return; }
            close(value);
        };
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") modal.querySelector("[data-ok]").click();
            if (event.key === "Escape") modal.querySelector("[data-cancel]").click();
        });
        input.focus();
        input.select();
    });
}

async function advanceWOStatus(id, nextStatus, statusNote = null) {
    const allowed = ["BONGKAR", "DEMPUL", "CAT", "FINISHING", "SELESAI", "CHECK OUT"];
    if (!allowed.includes(nextStatus)) return;

    // CHECK OUT wajib melalui modal keterangan. Jangan pernah langsung mengubah status
    // hanya karena tombol workflow diklik tanpa keterangan.
    if (nextStatus === "CHECK OUT" && !String(statusNote || "").trim()) {
        checkOutWO(id);
        return;
    }

    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;

    const current = getWOStatus(item);
    const expected = {
        "CHECK IN": "BONGKAR",
        "BONGKAR": "DEMPUL",
        "DEMPUL": "CAT",
        "FINISHING": "SELESAI",
        "CAT": "FINISHING",
        "SELESAI": "CHECK OUT"
    }[current];
    if (expected !== nextStatus) return;

    if (nextStatus === "BONGKAR" && (!item.kilometer || String(item.kilometer).trim() === "")) {
        const kilometer = await openKilometerModal(item.kilometer || "");
        if (kilometer === null || String(kilometer).trim() === "") return;
        item.kilometer = kilometer;
        item.check_in_at = item.check_in_at || new Date().toISOString();
    }

    const now = new Date().toISOString();

    if (usingLocalStorage) {
        item.status = nextStatus;
        if (nextStatus === "BONGKAR") item.pengerjaan_at = now;
        if (nextStatus === "DEMPUL") item.dempul_at = now;
        if (nextStatus === "CAT") item.cat_at = now;
        if (nextStatus === "FINISHING") item.finishing_at = now;
        if (nextStatus === "SELESAI") item.selesai_at = now;
        if (nextStatus === "CHECK OUT") item.check_out_at = now;
        addLocalHistory(item, nextStatus, now, statusNote);
        item.updatedAt = now;
        saveLocalWO();
        renderWOList();
        return;
    }

    try {
        await apiRequest(`/api/wo/${encodeURIComponent(id)}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: nextStatus, kilometer: item.kilometer || null, note: statusNote || null })
        });
        await loadWO();
    } catch (e) {
        myWorkshopAlert(`Gagal mengubah status menjadi ${nextStatus}.\n\n${e.message}`);
    }
}

async function checkInWO(id) {
    return advanceWOStatus(id, "BONGKAR");
}

async function selesaiWO(id) {
    return advanceWOStatus(id, "SELESAI");
}

async function checkOutWO(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;
    el("checkOutWOId").value = id;

    // checkOutWONumber adalah <input>, jadi nomor WO harus diisi melalui .value.
    // Sebelumnya menggunakan .textContent sehingga input terlihat kosong.
    const woNumber = item.wo_number ?? item.noWO ?? item.number ?? "-";
    el("checkOutWONumber").value = woNumber;
    el("checkOutNote").value = "";
    el("checkOutModal").classList.add("show");
    setTimeout(() => el("checkOutNote")?.focus(), 50);
}

function closeCheckOutModal() {
    el("checkOutModal")?.classList.remove("show");
}

async function submitCheckOut(event) {
    event.preventDefault();
    const id = el("checkOutWOId")?.value || "";
    const note = String(el("checkOutNote")?.value || "").trim();
    if (!id || !note) {
        myWorkshopAlert("Isi Keterangan saat Check Out wajib diisi.");
        return;
    }
    closeCheckOutModal();
    await advanceWOStatus(id, "CHECK OUT", note);
}

function showWODeleteModal(data) {
    return new Promise(resolve => {
        const old = document.getElementById("mwWODeleteModal");
        if (old) old.remove();
        const modal = document.createElement("div");
        modal.id = "mwWODeleteModal";
        const number = escapeHTML(data?.wo_number || data?.number || "-");
        const renderReason = () => {
            modal.innerHTML = `
                <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                    <div style="background:#fff;width:min(460px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                        <h3 style="margin:0 0 12px;color:#14213d;">Alasan Hapus WO</h3>
                        <p style="margin:0 0 16px;line-height:1.5;">Sebelum memasukkan password, tuliskan alasan penghapusan WO <strong>${number}</strong>.</p>
                        <label style="display:block;font-weight:700;margin-bottom:7px;">Alasan Penghapusan</label>
                        <textarea data-reason rows="4" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:7px;resize:vertical;margin-bottom:20px;"></textarea>
                        <div style="display:flex;justify-content:flex-end;gap:10px;">
                            <button type="button" data-cancel style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#fff;color:#14213d;font-weight:700;cursor:pointer;">Batal</button>
                            <button type="button" data-next style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#14213d;color:#fff;font-weight:700;cursor:pointer;">Lanjutkan</button>
                        </div>
                    </div>
                </div>`;
            modal.querySelector('[data-cancel]').onclick = () => { modal.remove(); resolve(null); };
            modal.querySelector('[data-next]').onclick = () => {
                const reason = modal.querySelector('[data-reason]').value.trim();
                if (!reason) { modal.querySelector('[data-reason]').focus(); return; }
                renderPassword(reason);
            };
            modal.querySelector('[data-reason]').focus();
        };
        const renderPassword = reason => {
            modal.innerHTML = `
                <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                    <div style="background:#fff;width:min(460px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                        <h3 style="margin:0 0 12px;color:#14213d;">Password Hapus WO</h3>
                        <p style="margin:0 0 16px;line-height:1.5;">Alasan sudah dicatat. Masukkan Password Hapus WO untuk melanjutkan penghapusan <strong>${number}</strong>.</p>
                        <label style="display:block;font-weight:700;margin-bottom:7px;">Password Hapus WO</label>
                        <input type="password" data-password autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:7px;margin-bottom:20px;">
                        <div style="display:flex;justify-content:flex-end;gap:10px;">
                            <button type="button" data-back style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#fff;color:#14213d;font-weight:700;cursor:pointer;">Kembali</button>
                            <button type="button" data-cancel style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#fff;color:#14213d;font-weight:700;cursor:pointer;">Batal</button>
                            <button type="button" data-ok style="padding:9px 18px;border:1px solid #14213d;border-radius:7px;background:#14213d;color:#fff;font-weight:700;cursor:pointer;">Hapus</button>
                        </div>
                    </div>
                </div>`;
            modal.querySelector('[data-back]').onclick = renderReason;
            modal.querySelector('[data-cancel]').onclick = () => { modal.remove(); resolve(null); };
            modal.querySelector('[data-ok]').onclick = () => {
                const password = modal.querySelector('[data-password]').value;
                if (!password) { modal.querySelector('[data-password]').focus(); return; }
                modal.remove(); resolve({ reason, password });
            };
            modal.querySelector('[data-password]').focus();
        };
        document.body.appendChild(modal);
        renderReason();
    });
}

async function deleteWO(id) {
    if (!isCurrentManagerMaster()) {
        if (typeof showMessage === "function") showMessage("Hanya Manager Master yang dapat menghapus WO.", "error");
        else myWorkshopAlert("Hanya Manager Master yang dapat menghapus WO.");
        return;
    }
    const data = woData.find(item => String(item.id) === String(id)) || {};
    const deletion = await showWODeleteModal(data);
    if (deletion === null) return;
    if (usingLocalStorage) {
        if (typeof showMessage === "function") showMessage("Penghapusan WO memerlukan koneksi ke server MyWorkshop agar password dan hak akses dapat diverifikasi.", "error");
        else myWorkshopAlert("Penghapusan WO memerlukan koneksi ke server MyWorkshop agar password dan hak akses dapat diverifikasi.");
        return;
    }
    try {
        await apiRequest(`/api/wo/${encodeURIComponent(id)}`, {
            method: "DELETE",
            body: JSON.stringify({ password: deletion.password, reason: deletion.reason })
        });
        await loadWO();
    } catch (e) {
        console.error("DELETE WO ERROR:", e);
        if (typeof showMessage === "function") showMessage("Gagal menghapus WO.\n\n" + e.message, "error");
        else myWorkshopAlert("Gagal menghapus WO.\n\n" + e.message);
    }
}

// ==========================================================
// WO SELESAI - DETAIL RIWAYAT & CHECK IN AGAIN
// ==========================================================

function formatHistoryStatus(status) {
    const labels = {
        "CHECK IN": "Check In",
        "CHECK IN AGAIN": "Check In Again",
        "BONGKAR": "Bongkar",
        "DEMPUL": "Dempul",
        "CAT": "Cat",
        "FINISHING": "Finishing",
        "SELESAI": "Selesai",
        "CHECK OUT": "Check Out",
        "KETERANGAN PROGRESS": "Keterangan Progress"
    };
    return labels[String(status || "").toUpperCase()] || status || "-";
}

function buildHistoryFallback(item) {
    const history = ensureLocalHistory(item);
    return history;
}

async function getWOHistory(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return [];

    if (usingLocalStorage) return buildHistoryFallback(item);

    try {
        const result = await apiRequest(`/api/wo/${encodeURIComponent(id)}/history`);
        return Array.isArray(result.data?.history) ? result.data.history : [];
    } catch (e) {
        console.warn("Riwayat WO API gagal, gunakan data lokal.", e);
        return buildHistoryFallback(item);
    }
}

function renderCompletedHistory(history) {
    const body = el("woHistoryBody");
    if (!body) return;

    if (!history.length) {
        body.innerHTML = '<div class="wo-empty">Belum ada riwayat proses WO.</div>';
        return;
    }

    const cycles = [];
    const byCycle = new Map();
    history.forEach(row => {
        const cycle = Number(row.cycle_no || 1);
        if (!byCycle.has(cycle)) {
            byCycle.set(cycle, []);
            cycles.push(cycle);
        }
        byCycle.get(cycle).push(row);
    });

    body.innerHTML = cycles.map(cycle => {
        const rows = byCycle.get(cycle) || [];
        const title = cycle === 1 ? "Proses Awal" : `Proses Ulang / Siklus ${cycle}`;
        return `<div class="wo-history-cycle">
            <div class="wo-history-cycle-title">${escapeHTML(title)}</div>
            <div class="wo-history-timeline">
                ${rows.map(row => `<div class="wo-history-row">
                    <div class="wo-history-dot"></div>
                    <div class="wo-history-content">
                        <strong>${escapeHTML(formatHistoryStatus(row.status))}</strong>
                        <span>${escapeHTML(formatDate(row.changed_at))}</span>
                        ${row.note ? `<div class="wo-history-note">Keterangan: ${escapeHTML(row.note)}</div>` : ""}
                    </div>
                </div>`).join("")}
            </div>
        </div>`;
    }).join("");
}

async function openWOCompletedDetail(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return myWorkshopAlert("WO tidak ditemukan.");

    el("woHistoryNumber").textContent = item.wo_number ?? item.noWO ?? "-";
    el("woHistoryCustomer").textContent = item.customer_name ?? item.customerName ?? item.customer ?? "-";
    el("woHistoryPlate").textContent = item.plate_number ?? item.plateNumber ?? item.plate ?? "-";
    el("woHistoryBody").innerHTML = '<div class="wo-empty">Memuat riwayat...</div>';
    el("woHistoryModal").classList.add("show");

    const history = await getWOHistory(id);
    renderCompletedHistory(history);
}

function closeWOHistoryModal() {
    el("woHistoryModal")?.classList.remove("show");
}

async function submitCheckInAgain(id) {
    const note = String(el("checkInAgainNote")?.value || "").trim();
    if (!note) {
        myWorkshopAlert("Keterangan Check In Again wajib diisi.");
        return;
    }

    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;

    const now = new Date().toISOString();

    if (usingLocalStorage) {
        const history = ensureLocalHistory(item);
        const nextCycle = Math.max(1, ...history.map(x => Number(x.cycle_no || 1))) + 1;
        addLocalHistory(item, "CHECK IN AGAIN", now, note, nextCycle);
        addLocalHistory(item, "CHECK IN", now, "Memulai ulang proses setelah Check In Again.", nextCycle);
        item.status = "CHECK IN";
        item.check_in_at = now;
        item.pengerjaan_at = "";
        item.dempul_at = "";
        item.cat_at = "";
        item.finishing_at = "";
        item.selesai_at = "";
        item.check_out_at = "";
        item.updatedAt = now;
        saveLocalWO();
        closeCheckInAgainModal();
        renderWOList();
        myWorkshopAlert("WO berhasil Check In Again dan kembali ke WO untuk proses ulang.");
        return;
    }

    try {
        const result = await apiRequest(`/api/wo/${encodeURIComponent(id)}/check-in-again`, {
            method: "POST",
            body: JSON.stringify({ note })
        });
        closeCheckInAgainModal();
        await loadWO();
        myWorkshopAlert(result.message || "WO berhasil Check In Again.");
    } catch (e) {
        myWorkshopAlert("Gagal melakukan Check In Again.\n\n" + e.message);
    }
}

function openCheckInAgainModal(id) {
    el("checkInAgainWOId").value = id;
    el("checkInAgainWONumber").textContent = woData.find(w => getWOId(w) === String(id))?.wo_number || "-";
    el("checkInAgainNote").value = "";
    el("checkInAgainModal").classList.add("show");
    setTimeout(() => el("checkInAgainNote")?.focus(), 50);
}

function closeCheckInAgainModal() {
    el("checkInAgainModal")?.classList.remove("show");
}

// ==========================================================
// PRINT WO -> PDF
// ==========================================================

async function printWO(id) {
    const item = woData.find(w => getWOId(w) === String(id));
    if (!item) return;

    let w = item;
    let spareparts = item.spareparts || [];
    let jasa = item.jasa || [];
    let jasaLain = item.jasa_lain || [];

    const hasPrintValue = (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        String(value).trim() !== "0";
    const filterPrintItems = (list, fields) =>
        (Array.isArray(list) ? list : []).filter(row =>
            fields.some(field => hasPrintValue(row?.[field]))
        );

    if (!usingLocalStorage) {
        try {
            const result = await apiRequest(`/api/wo/${encodeURIComponent(id)}`);
            w = result.data.wo;
            spareparts = result.data.spareparts || [];
            const localSpareparts = item.spareparts || [];
            spareparts = spareparts.map((sp, idx) => ({ ...sp, supply_bengkel: sp.supply_bengkel ?? sp.supplyBengkel ?? sp.supply ?? localSpareparts[idx]?.supply_bengkel ?? localSpareparts[idx]?.supplyBengkel ?? localSpareparts[idx]?.supply ?? "BENGKEL" }));
            jasa = result.data.jasa || [];
            jasaLain = result.data.jasa_lain || [];
        } catch (e) {
            console.warn(e);
        }
    }

    const targetDate = w.target_date ?? w.targetDate ?? "";
    const woNumber = w.wo_number ?? w.noWO ?? w.number ?? "-";
    const estimateNumber = w.estimate_number ?? w.noEstimasi ?? "-";
    const customer = w.customer_name ?? w.customerName ?? w.customer ?? "-";
    const insurerId = w.insurer_id ?? w.insurerId ?? "";
    let insurer = String(w.insurer_alias ?? w.insurerAlias ?? "").trim();
    if (!insurer && insurerId) {
        try {
            // Endpoint detail /api/asuransi/:id tidak mengembalikan field alias.
            // Ambil dari endpoint aktif yang mengembalikan alias dan cocokkan ID.
            const insurerResponse = await fetch("/api/asuransi/aktif", { cache: "no-store" });
            const insurerResult = await insurerResponse.json().catch(() => ({}));
            const insurerList = Array.isArray(insurerResult)
                ? insurerResult
                : (Array.isArray(insurerResult?.data) ? insurerResult.data : []);
            const insurerRecord = insurerList.find(item =>
                String(item?.id ?? "") === String(insurerId)
            );
            insurer = String(
                insurerRecord?.alias ?? insurerRecord?.insurer_alias ?? insurerRecord?.insurerAlias ?? ""
            ).trim();
        } catch (e) {
            console.warn("Gagal mengambil Alias Asuransi untuk print WO:", e);
        }
    }
    insurer = insurer || "-";
    const plate = w.plate_number ?? w.plateNumber ?? w.plate ?? "-";
    const brand = w.brand ?? "-";
    const model = w.model ?? "-";
    const year = w.year ?? "-";
    const color = w.color ?? "-";
    const vin = w.vin_number ?? w.vin ?? "-";
    const engine = w.engine_number ?? w.engine ?? "-";
    const agent = w.agent ?? "-";

    const printSpareparts = filterPrintItems(spareparts, [
        "part_name", "partName", "name", "quantity", "qty", "supply_bengkel", "supplyBengkel"
    ]);
    const printJasa = filterPrintItems(jasa, [
        "panel_name", "panelName", "panel", "service_type", "serviceType", "jenis", "amount", "unit_price"
    ]);
    const printJasaLain = filterPrintItems(jasaLain, [
        "service_name", "serviceName", "name", "amount", "unit_price", "total_price"
    ]);

    const spRows = printSpareparts.length ? printSpareparts.map((x,i) => `<tr><td>${i+1}</td><td>${escapeHTML(x.part_name ?? x.partName ?? x.name ?? "-")}</td><td>${escapeHTML(x.supply_bengkel ?? x.supplyBengkel ?? x.supply ?? "BENGKEL")}</td><td>${escapeHTML(x.quantity ?? x.qty ?? "-")}</td><td></td><td></td><td></td></tr>`).join("") : `<tr><td colspan="7">Tidak ada data.</td></tr>`;
    const jasaRows = printJasa.length ? printJasa.map((x,i) => `<tr><td>${i+1}</td><td>${escapeHTML(x.panel_name ?? x.panelName ?? x.panel ?? "-")}</td><td>${escapeHTML(x.service_type ?? x.serviceType ?? x.jenis ?? "-")}</td><td></td></tr>`).join("") : `<tr><td colspan="4">Tidak ada data.</td></tr>`;
    const lainRows = printJasaLain.length ? printJasaLain.map((x,i) => `<tr><td>${i+1}</td><td>${escapeHTML(x.service_name ?? x.serviceName ?? x.name ?? "-")}</td><td></td></tr>`).join("") : `<tr><td colspan="3">Tidak ada data.</td></tr>`;

    await recordDocumentPrint("WO", id);

    const workshopHeader = await getWorkshopPrintHeader();

    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
        myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak WO.");
        return;
    }

    printWindow.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title>
<style>
@page{size:A4 portrait;margin:10mm}
.header > div:first-child{margin-bottom:4px!important}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:11px}.sheet{width:190mm;margin:0 auto}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:0;padding-bottom:0;margin-bottom:4px}.brand{font-size:20px;font-weight:700}.sub{font-size:10px;color:#555;margin-top:2px}.title{text-align:center;font-size:18px;font-weight:700;margin:8px 0 10px}.meta{width:100%;border-collapse:collapse;margin-bottom:9px}.meta td{padding:3px 5px;vertical-align:top}.meta .label{font-weight:700;width:20%}.box{border:1px solid #222;margin-top:8px}.box-title{font-weight:700;background:#eee;padding:5px;border-bottom:1px solid #222}.info{display:grid;grid-template-columns:1fr 1fr;padding:6px}.info div{padding:3px 6px}.label2{display:inline-block;width:105px;font-weight:700}.items{width:100%;border-collapse:collapse}.items th,.items td{border:1px solid #777;padding:5px}.items th{background:#eee;text-align:center}.items td:first-child{text-align:center;width:7%}.progress-title{text-align:center;font-weight:700;margin:12px 0 5px;font-size:12px}.progress{width:100%;border-collapse:collapse;table-layout:fixed}.progress th,.progress td{border:1px solid #777;padding:5px;text-align:center;vertical-align:middle;height:25px}.progress th{background:#eee;font-weight:700}.progress .left{text-align:left}.note{border:1px solid #777;padding:7px;min-height:32px;margin-top:8px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px;text-align:center}.signbox{height:60px}.footer{text-align:center;margin-top:10px;font-size:9px;color:#555}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="sheet">
<div class="header">${workshopHeader}<div style="text-align:right"><b>WORK ORDER</b><br>${escapeHTML(woNumber)}</div></div>
<div class="title">WORK ORDER</div>
<table class="meta"><tr><td class="label">No. WO</td><td>${escapeHTML(woNumber)}</td><td class="label">Tanggal WO</td><td>${escapeHTML(formatDate(w.created_at ?? w.createdAt ?? w.date))}</td></tr><tr><td class="label">No. Estimasi</td><td>${escapeHTML(estimateNumber)}</td><td class="label">Tanggal Target</td><td><b>${escapeHTML(formatDateOnly(targetDate))}</b></td></tr><tr><td class="label">Status</td><td>${escapeHTML(getWOStatus(w))}</td><td class="label">Kilometer</td><td>${escapeHTML(w.kilometer ?? "-")}</td></tr></table>
<div class="box"><div class="box-title">DATA CUSTOMER & KENDARAAN</div><div class="info">
<div><span class="label2">Customer</span>${escapeHTML(customer)}</div><div><span class="label2">Asuransi</span>${escapeHTML(insurer)}</div>
<div><span class="label2">No. Polisi</span>${escapeHTML(plate)}</div><div><span class="label2">Merk / Type</span>${escapeHTML(brand)} / ${escapeHTML(model)}</div>
<div><span class="label2">Tahun</span>${escapeHTML(year)}</div><div><span class="label2">Warna</span>${escapeHTML(color)}</div>
<div><span class="label2">No. Rangka</span>${escapeHTML(vin)}</div><div><span class="label2">No. Mesin</span>${escapeHTML(engine)}</div><div><span class="label2">Agent</span>${escapeHTML(agent)}</div>
</div></div>
${String(w.notes ?? w.note ?? "").trim() ? `<div class="box"><div class="box-title">CATATAN WO</div><div style="padding:8px;white-space:pre-wrap;min-height:32px">${escapeHTML(w.notes ?? w.note ?? "")}</div></div>` : ""}
${printSpareparts.length ? `<div class="box"><div class="box-title">SPAREPART / MATERIAL</div><table class="items"><thead><tr><th>No.</th><th>Nama Sparepart</th><th>Supply/Bengkel</th><th>QTY</th><th>TGL DATANG</th><th>TEKNISI</th><th>TGL AMBIL</th></tr></thead><tbody>${spRows}</tbody></table></div>` : ""}
${printJasa.length ? `<div class="box"><div class="box-title">JASA PERBAIKAN / PENGECATAN</div><table class="items"><thead><tr><th>No.</th><th>Nama Panel</th><th>Jenis</th><th>Keterangan</th></tr></thead><tbody>${jasaRows}</tbody></table></div>` : ""}
${printJasaLain.length ? `<div class="box"><div class="box-title">JASA LAIN-LAIN</div><table class="items"><thead><tr><th>No.</th><th>Nama Jasa</th><th>Keterangan</th></tr></thead><tbody>${lainRows}</tbody></table></div>` : ""}
<div class="progress-title">PROGRESS & DOKUMENTASI</div>
<table class="progress"><thead><tr><th style="width:16%">PROGRESS</th><th style="width:11%">PEKERJA</th><th style="width:12%">TGL SELESAI</th><th style="width:8%">PARAF</th><th style="width:22%">DOKUMENTASI</th><th style="width:11%">PEKERJA</th><th style="width:12%">TGL</th><th style="width:8%">PARAF</th></tr></thead><tbody>
<tr><td class="left">Bongkar</td><td></td><td></td><td></td><td class="left">Foto Rusak</td><td></td><td></td><td></td></tr>
<tr><td class="left">Las Ketok</td><td></td><td></td><td></td><td class="left">Foto B/P Kaca</td><td></td><td></td><td></td></tr>
<tr><td class="left">Dempul</td><td></td><td></td><td></td><td class="left">Foto Epoxy</td><td></td><td></td><td></td></tr>
<tr><td class="left">Cat</td><td></td><td></td><td></td><td class="left">Foto Ganti Part</td><td></td><td></td><td></td></tr>
<tr><td class="left">Finishing</td><td></td><td></td><td></td><td class="left">Foto No. Rangka</td><td></td><td></td><td></td></tr>
<tr><td class="left">Poles</td><td></td><td></td><td></td><td class="left">Foto No. Mesin</td><td></td><td></td><td></td></tr>
<tr><td class="left">QC</td><td></td><td></td><td></td><td class="left">Foto 4 Sisi</td><td></td><td></td><td></td></tr>
</tbody></table>
<div class="note"><b>NOTE</b><br>1. SELESAI &nbsp;&nbsp;&nbsp;&nbsp; 2. HUTANG PART &nbsp;&nbsp;&nbsp;&nbsp; 3. BELUM SURAT PUAS &nbsp;&nbsp;&nbsp;&nbsp; 4. BELUM SPK &nbsp;&nbsp;&nbsp;&nbsp; 5. BELUM LUNAS OR &nbsp;&nbsp;&nbsp;&nbsp; 6. LAINNYA ..............................</div>
<div class="sign"><div>Dibuat oleh<br><br><br>________________________<br>(Estimator)</div><div>Diterima oleh<br><br><br>________________________<br>(Kabag Produksi)</div></div>
<div class="footer">Work Order MyWorkshop</div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>`);
    printWindow.document.close();
}

// ==========================================================
// LAPORAN PROGRESS WO AKTIF
// ==========================================================

let progressReportData = [];

function progressDateValue(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
}

function progressDateText(value) {
    if (!value) return "-";
    return formatDate(value);
}

function progressDaysBetween(startValue, endValue) {
    const start = progressDateValue(startValue);
    const end = progressDateValue(endValue);
    if (!start || !end) return null;
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((endDay - startDay) / 86400000));
}

function progressTodayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isProgressLate(targetValue) {
    const target = progressDateValue(targetValue);
    if (!target) return false;
    const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return progressTodayStart() > targetDay;
}

function progressDurationText(days) {
    if (days === null || days === undefined) return "-";
    return `${days} hari`;
}

function getLatestLocalCheckInAgain(item) {
    const history = ensureLocalHistory(item) || [];
    const rows = history
        .filter(x => String(x.status || "").toUpperCase() === "CHECK IN AGAIN")
        .sort((a, b) => String(b.changed_at || "").localeCompare(String(a.changed_at || "")));
    return rows[0] || null;
}

function normalizeProgressRow(row) {
    return {
        ...row,
        id: row.id ?? row.wo_id,
        status: getWOStatus(row),
        customer_name: row.customer_name ?? row.customerName ?? row.customer ?? "-",
        brand: row.brand ?? "-",
        model: row.model ?? "-",
        plate_number: row.plate_number ?? row.plateNumber ?? row.plate ?? "-",
        insurer_alias: row.insurer_alias ?? row.insurerAlias ?? row.insurer_name ?? row.insurerName ?? "-",
        progress_note: row.progress_note ?? row.progressNote ?? "",
        target_date: row.target_date ?? row.targetDate ?? "",
        check_in_at: row.check_in_at ?? row.checkInAt ?? row.created_at ?? row.createdAt ?? "",
        check_in_again_at: row.check_in_again_at ?? row.checkInAgainAt ?? "",
        check_in_again_note: row.check_in_again_note ?? row.checkInAgainNote ?? ""
    };
}

async function loadProgressReport() {
    const body = el("progressTableBody");
    if (!body) return;
    body.innerHTML = '<tr><td colspan="13" class="progress-empty">Memuat Laporan Progress...</td></tr>';

    try {
        if (!usingLocalStorage) {
            const result = await apiRequest(`/api/wo/progress-report?_=${Date.now()}`);
            progressReportData = (Array.isArray(result.data) ? result.data : []).map(normalizeProgressRow);
        } else {
            progressReportData = woData
                .filter(w => getWOStatus(w) !== "CHECK OUT")
                .map(w => {
                    const latest = getLatestLocalCheckInAgain(w);
                    return normalizeProgressRow({
                        ...w,
                        check_in_again_at: latest?.changed_at || "",
                        check_in_again_note: latest?.note || ""
                    });
                });
        }
        renderProgressReport();
    } catch (error) {
        console.error("Laporan Progress gagal dimuat:", error);
        body.innerHTML = `<tr><td colspan="13" class="progress-empty">${escapeHTML(error.message || "Gagal memuat Laporan Progress.")}</td></tr>`;
    }
}

function progressStatusClass(status) {
    const key = String(status || "").toUpperCase().replace(/\s+/g, "-");
    const map = {
        "CHECK-IN": "progress-status-checkin",
        "BONGKAR": "progress-status-bongkar",
        "DEMPUL": "progress-status-dempul",
        "CAT": "progress-status-cat",
        "FINISHING": "progress-status-finishing",
        "SELESAI": "progress-status-selesai"
    };
    return map[key] || "progress-status-default";
}

function renderProgressReport() {
    const body = el("progressTableBody");
    const countEl = el("progressCount");
    if (!body) return;
    if (countEl) countEl.textContent = `${progressReportData.length} WO aktif`;
    if (!progressReportData.length) {
        body.innerHTML = '<tr><td colspan="13" class="progress-empty">Tidak ada WO aktif.</td></tr>';
        return;
    }
    const now = new Date();
    body.innerHTML = progressReportData.map((row, index) => {
        const late = isProgressLate(row.target_date);
        const elapsed = progressDaysBetween(row.check_in_at, now);
        const targetDuration = progressDaysBetween(row.check_in_at, row.target_date);
        const checkAgain = row.check_in_again_at
            ? `<div><strong>${escapeHTML(progressDateText(row.check_in_again_at))}</strong></div><div class="progress-note">${escapeHTML(row.check_in_again_note || "-")}</div>`
            : '<span style="color:#94a3b8">-</span>';
        const statusClass = progressStatusClass(row.status);
        const vehicle = `${row.brand || "-"} ${row.model || "-"}`.trim();
        const vehicleInfo = `${vehicle}<div style="color:#64748b;margin-top:3px">${escapeHTML(row.plate_number || "-")}${row.color && row.color !== "-" ? ` · ${escapeHTML(row.color)}` : ""}</div>`;
        return `<tr class="${late ? "warning-row" : ""}">
            <td>${index + 1}</td>
            <td><strong>${escapeHTML(row.wo_number || "-")}</strong></td>
            <td><strong>${escapeHTML(row.insurer_alias || "-")}</strong></td>
            <td>${vehicleInfo}</td>
            <td><span class="progress-status-badge ${statusClass}">${escapeHTML(row.status)}</span></td>
            <td>${escapeHTML(progressDateText(row.check_in_at))}</td>
            <td>${escapeHTML(progressDateText(row.target_date))}</td>
            <td class="progress-duration">${escapeHTML(progressDurationText(elapsed))}</td>
            <td class="progress-duration">${escapeHTML(progressDurationText(targetDuration))}</td>
            <td class="progress-note">${escapeHTML(row.progress_note || "-")}</td>
            <td>${checkAgain}</td>
            <td class="progress-note">${escapeHTML(row.check_in_again_note || "-")}</td>
            <td>${late ? '<span class="progress-warning"><span class="progress-warning-dot"></span> MELEWATI TARGET</span>' : '<span style="color:#16a34a;font-weight:700">Sesuai Target</span>'}</td>
        </tr>`;
    }).join("");
}
function closeProgressModal() {
    el("progressModal")?.classList.remove("show");
}

async function openProgressModal() {
    el("progressModal")?.classList.add("show");
    await loadProgressReport();
}

async function printProgressReport() {
    if (!progressReportData.length) {
        myWorkshopAlert("Tidak ada WO aktif untuk dicetak.");
        return;
    }

    const printNow = new Date();
    const rows = progressReportData.map((row, index) => {
        const late = isProgressLate(row.target_date);
        const elapsed = progressDaysBetween(row.check_in_at, printNow);
        const targetDuration = progressDaysBetween(row.check_in_at, row.target_date);
        const vehicleColor = row.color || row.vehicle_color || "-";
        return `<tr class="${late ? "late" : ""}">
            <td>${index + 1}</td><td>${escapeHTML(row.wo_number || "-")}</td>
            <td>${escapeHTML(row.insurer_alias || "-")}</td>
            <td>${escapeHTML(row.brand)} ${escapeHTML(row.model)}<br>${escapeHTML(row.plate_number)}${row.color && row.color !== "-" ? ` · ${escapeHTML(row.color)}` : ""}</td>
            <td>${escapeHTML(row.status)}</td>
            <td>${escapeHTML(progressDateText(row.check_in_at))}</td>
            <td>${escapeHTML(progressDateText(row.target_date))}</td>
            <td>${escapeHTML(progressDurationText(elapsed))}</td><td>${escapeHTML(progressDurationText(targetDuration))}</td>
            <td>${escapeHTML(row.progress_note || "-")}</td>
            <td>${row.check_in_again_at ? escapeHTML(progressDateText(row.check_in_again_at)) : "-"}</td>
            <td>${escapeHTML(row.check_in_again_note || "-")}</td>
            <td>${late ? "⚠ MELEWATI TARGET" : "Sesuai Target"}</td>
        </tr>`;
    }).join("");

    const workshopHeader = await getWorkshopPrintHeader();

    const printWindow = window.open("", "_blank", "width=1400,height=900");
    if (!printWindow) {
        myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak Laporan Progress.");
        return;
    }

    printWindow.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title>
<style>
@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:9px}.header{display:flex;justify-content:space-between;border-bottom:0;padding-bottom:7px;margin-bottom:8px}.brand{font-size:18px;font-weight:700}.sub{font-size:9px;color:#555}.title{text-align:center;font-size:15px;font-weight:700;margin:5px 0 2px}.meta{text-align:center;color:#555;font-size:9px;margin-bottom:8px}.table{width:100%;border-collapse:collapse}.table th,.table td{border:1px solid #777;padding:4px;vertical-align:top}.table th{background:#eee;text-align:center;font-size:8px}.table .late{background:#ffe4e6}.footer{margin-top:7px;text-align:right;color:#555;font-size:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="header">${workshopHeader}<div style="text-align:right"><b>LAPORAN PROGRESS</b><br>${escapeHTML(printNow.toLocaleString("id-ID"))}</div></div>
<div class="title">LAPORAN PROGRESS WORK ORDER AKTIF</div><div class="meta">${progressReportData.length} WO aktif &nbsp;|&nbsp; Sampai waktu cetak: ${escapeHTML(printNow.toLocaleString("id-ID"))}</div>
<table class="table"><thead><tr><th>No</th><th>No. WO</th><th>Asuransi</th><th>Kendaraan</th><th>Status</th><th>Check In</th><th>Tanggal Target</th><th>Lama di Bengkel</th><th>Durasi Target</th><th>Keterangan Progress</th><th>Check In Again</th><th>Keterangan</th><th>Peringatan</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Dicetak dari MyWorkshop</div></body></html>`);
    printWindow.document.close();
}

function setupButtons() {
    el("btnBuatWO")?.addEventListener("click", openNewWO);
    el("btnLaporanProgress")?.addEventListener("click", openProgressModal);
    el("btnCloseProgress")?.addEventListener("click", closeProgressModal);
    el("btnRefreshProgress")?.addEventListener("click", loadProgressReport);
    el("btnPrintProgress")?.addEventListener("click", printProgressReport);
    el("progressModal")?.addEventListener("click", e => {
        if (e.target === el("progressModal")) closeProgressModal();
    });
    el("btnCloseProgressNote")?.addEventListener("click", closeProgressNoteModal);
    el("btnCancelProgressNote")?.addEventListener("click", closeProgressNoteModal);
    el("btnSaveProgressNote")?.addEventListener("click", saveProgressNote);
    el("progressNoteModal")?.addEventListener("click", e => {
        if (e.target === el("progressNoteModal")) closeProgressNoteModal();
    });
    el("progressNoteInput")?.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveProgressNote();
    });
    el("btnCloseWOModal")?.addEventListener("click", closeWOModal);
    el("btnCancelWO")?.addEventListener("click", closeWOModal);
    el("woEstimasiSearch")?.addEventListener("focus", openEstimasiPicker);
    el("woEstimasiSearch")?.addEventListener("input", searchEstimasiPicker);
    el("woEstimasiSearch")?.addEventListener("keydown", e => {
        if (e.key === "Escape") el("woEstimasiResults")?.classList.remove("show");
    });
    document.addEventListener("click", e => {
        const picker = document.querySelector(".wo-estimate-picker");
        if (picker && !picker.contains(e.target)) el("woEstimasiResults")?.classList.remove("show");
    });
    el("woForm")?.addEventListener("submit", submitWO);
    el("woModal")?.addEventListener("click", e => {
        if (e.target === el("woModal")) closeWOModal();
    });
    el("searchWO")?.addEventListener("input", renderWOList);
    el("btnCloseWOHistory")?.addEventListener("click", closeWOHistoryModal);
    el("btnCloseCheckInAgain")?.addEventListener("click", closeCheckInAgainModal);
    el("btnCancelCheckInAgain")?.addEventListener("click", closeCheckInAgainModal);
    el("checkInAgainForm")?.addEventListener("submit", e => {
        e.preventDefault();
        submitCheckInAgain(el("checkInAgainWOId")?.value || "");
    });
    el("woHistoryModal")?.addEventListener("click", e => {
        if (e.target === el("woHistoryModal")) closeWOHistoryModal();
    });
    el("checkInAgainModal")?.addEventListener("click", e => {
        if (e.target === el("checkInAgainModal")) closeCheckInAgainModal();
    });
    el("btnCloseCheckOut")?.addEventListener("click", closeCheckOutModal);
    el("btnCancelCheckOut")?.addEventListener("click", closeCheckOutModal);
    el("checkOutForm")?.addEventListener("submit", submitCheckOut);
    el("checkOutModal")?.addEventListener("click", e => {
        if (e.target === el("checkOutModal")) closeCheckOutModal();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    if (el("currentDate")) {
        el("currentDate").textContent = new Date().toLocaleDateString("id-ID", {
            weekday: "long", day: "2-digit", month: "long", year: "numeric"
        });
    }
    setupButtons();
    await loadEstimasiData();
    await loadWO();
    loadEstimasiSelect();
});

window.openNewWO = openNewWO;
window.openWOForm = openNewWO;
window.openWOFromServer = openWOFromServer;
window.closeWOModal = closeWOModal;
window.closeWOForm = closeWOModal;
window.submitWO = submitWO;
window.deleteWO = deleteWO;
window.checkInWO = checkInWO;
window.advanceWOStatus = advanceWOStatus;
window.selesaiWO = selesaiWO;
window.checkOutWO = checkOutWO;
window.closeCheckOutModal = closeCheckOutModal;
window.submitCheckOut = submitCheckOut;
window.printWO = printWO;
window.openWOCompletedDetail = openWOCompletedDetail;
window.openCheckInAgainModal = openCheckInAgainModal;
window.openSparepartInfo = openSparepartInfo;
window.closeSparepartInfo = closeSparepartInfo;
window.closeWOHistoryModal = closeWOHistoryModal;
window.closeCheckInAgainModal = closeCheckInAgainModal;
window.submitCheckInAgain = submitCheckInAgain;
window.populateEstimasiSelect = loadEstimasiSelect;
window.openProgressModal = openProgressModal;
window.closeProgressModal = closeProgressModal;
window.loadProgressReport = loadProgressReport;
window.printProgressReport = printProgressReport;
window.openDocumentHistory = openDocumentHistory;
window.closeDocumentHistory = closeDocumentHistory;


// ==========================================================
// RIWAYAT DOKUMEN - CETAK & REVISI
// ==========================================================
function cloneDocumentHistoryValue(value){
    try { return JSON.parse(JSON.stringify(value ?? {})); } catch (_) { return {}; }
}
async function recordDocumentPrint(type,id){
    try { return await fetch(`/api/document-history/${encodeURIComponent(type)}/${encodeURIComponent(id)}/print`,{method:"POST",headers:{"Content-Type":"application/json"}}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);return d;}); }
    catch(e){ console.warn("Gagal mencatat cetak dokumen:",e); return null; }
}
async function recordDocumentRevision(type,id,before,after){
    if(!before || !after) return null;
    try { return await fetch(`/api/document-history/${encodeURIComponent(type)}/${encodeURIComponent(id)}/revision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({before,after})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);return d;}); }
    catch(e){ console.warn("Gagal mencatat revisi dokumen:",e); return null; }
}
function ensureDocumentHistoryModal(){
    if(document.getElementById("documentHistoryModal")) return;
    const style=document.createElement("style");
    style.textContent=`#documentHistoryModal{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;align-items:center;justify-content:center;padding:18px;z-index:5000}#documentHistoryModal.show{display:flex}.document-history-box{width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:22px}.document-history-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.document-history-head h2{margin:0;font-size:19px}.document-history-close{border:0;background:transparent;font-size:27px;cursor:pointer}.document-history-summary{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:16px}.document-history-card{border:1px solid #e5e7eb;border-radius:8px;padding:11px}.document-history-card span{display:block;color:#6b7280;font-size:11px}.document-history-card strong{display:block;margin-top:4px;font-size:17px}.document-history-event{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:9px}.document-history-event-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.document-history-event-title{font-weight:800}.document-history-event-meta{color:#6b7280;font-size:11px}.document-history-change{display:grid;grid-template-columns:minmax(180px,1fr) minmax(140px,1fr) minmax(140px,1fr);gap:8px;padding:6px 0;border-top:1px solid #f1f5f9;font-size:12px}.document-history-change:first-child{margin-top:9px}.document-history-change b{font-weight:700}.document-history-empty{text-align:center;color:#6b7280;padding:25px}@media(max-width:650px){.document-history-summary{grid-template-columns:1fr}.document-history-change{grid-template-columns:1fr;gap:2px}}`;
    document.head.appendChild(style);
    const modal=document.createElement("div");
    modal.id="documentHistoryModal";
    modal.innerHTML=`<div class="document-history-box"><div class="document-history-head"><h2 id="documentHistoryTitle">Riwayat Dokumen</h2><button type="button" class="document-history-close" onclick="closeDocumentHistory()">×</button></div><div class="document-history-summary"><div class="document-history-card"><span>Jumlah Perubahan</span><strong id="documentHistoryRevisionCount">0 kali</strong></div></div><div id="documentHistoryBody"></div></div>`;
    modal.addEventListener("click",e=>{if(e.target===modal)closeDocumentHistory()});
    document.body.appendChild(modal);
}
function closeDocumentHistory(){document.getElementById("documentHistoryModal")?.classList.remove("show")}
function documentHistoryFieldLabel(field){
    const raw=String(field||"").trim();
    const parts=raw.split(".").filter(Boolean);
    const cleanParts=parts.filter(part=>!/^\d+$/.test(part));
    const key=cleanParts[cleanParts.length-1] || raw;
    const normalizedKey=key.replace(/([a-z])([A-Z])/g,"$1_$2").toLowerCase();
    const labels={
        ppn_percent:"Persen PPN", pph_percent:"Persen PPH",
        material_percent:"Persen Material", labour_percent:"Persen Labour",
        ppn_type:"Jenis PPN", ppn_base:"Dasar PPN", ppn_amount:"Nominal PPN",
        pph_amount:"Nominal PPH", own_risk:"Own Risk (OR)",
        claim_number:"No. Klaim Asuransi", claim_no:"No. Klaim Asuransi", polis_number:"No. Polis",
        insurer_id:"Asuransi", insurer_alias:"Alias Asuransi", insurer_name:"Nama Asuransi",
        estimate_id:"No. Estimasi", estimate_number:"No. Estimasi",
        customer_id:"Customer", customer_code:"Kode Customer", customer_name:"Nama Customer",
        vehicle_id:"Kendaraan", plate_number:"No. Polisi", brand:"Merek", model:"Tipe / Model",
        year:"Tahun", color:"Warna", vin_number:"No. Rangka", engine_number:"No. Mesin",
        customer_note:"Catatan Customer", notes:"Catatan", progress_note:"Keterangan Progress",
        target_date:"Tanggal Target", kilometer:"Kilometer",
        check_in_at:"Check In", pengerjaan_at:"Mulai Pengerjaan", selesai_at:"Tanggal Selesai",
        check_out_at:"Check Out", status:"Status", created_by:"Dibuat Oleh",
        created_at:"Tanggal Dibuat", updated_at:"Terakhir Diperbarui",
        service_type:"Jenis Jasa", panel_name:"Nama Panel", service_name:"Nama Jasa",
        part_name:"Nama Sparepart", part_number:"No. Sparepart", quantity:"Qty", qty:"Qty",
        unit:"Satuan", unit_price:"Harga Satuan", discount:"Diskon", total_price:"Total Harga",
        alias:"Alias Asuransi", name:"Nama", address:"Alamat", phone:"No. Telepon",
        email:"Email", npwp:"NPWP", is_active:"Status", material_amount:"Nominal Material",
        labour_amount:"Nominal Labour", sparepart_amount:"Nominal Sparepart",
        jasa_lain_amount:"Nominal Jasa Lain", grand_total:"Grand Total",
        salvage_amount:"Salvage", system_fee:"Biaya Sistem", payable_percent:"Persen Dibayar",
        price:"Harga", cost_price:"Harga Beli", selling_price:"Harga Jual",
        payment_date:"Tanggal Pembayaran", payment_amount:"Nominal Pembayaran",
        invoice_number:"No. Kuitansi", invoice_date:"Tanggal Kuitansi",
        reference_number:"No. Referensi", policy_number:"No. Polis"
    };
    let label=labels[normalizedKey] || key.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    const indexParts=parts.filter(part=>/^\d+$/.test(part));
    if(indexParts.length){
        const collection=cleanParts.length>1 ? cleanParts[cleanParts.length-2] : "";
        const collectionLabels={spareparts:"Sparepart", jasa:"Jasa", jasa_lain:"Jasa Lain", items:"Item"};
        const collectionLabel=collectionLabels[collection] || collection.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
        label=`${collectionLabel || "Data"} #${Number(indexParts[indexParts.length-1])+1} — ${label}`;
    }
    return label;
}
async function openDocumentHistory(type,id,number){
    ensureDocumentHistoryModal();
    const modal=document.getElementById("documentHistoryModal"),body=document.getElementById("documentHistoryBody");
    const historyTypeLabels={ESTIMASI:"Estimasi",WO:"Work Order"};
    document.getElementById("documentHistoryTitle").textContent=`Riwayat ${historyTypeLabels[String(type||"").toUpperCase()]||type} — ${number||"-"}`;
    document.getElementById("documentHistoryRevisionCount").textContent="Memuat...";
    body.innerHTML='<div class="document-history-empty">Memuat riwayat dokumen...</div>';
    modal.classList.add("show");
    try{
        const r=await fetch(`/api/document-history/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,{cache:"no-store"});
        const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);
        const data=d.data||{}; document.getElementById("documentHistoryRevisionCount").textContent=`${Number(data.revision_count||0)} kali`;
        const history=Array.isArray(data.history)?data.history:[];
        if(!history.length){body.innerHTML='<div class="document-history-empty">Belum ada perubahan yang tercatat.</div>';return;}
        body.innerHTML=history.map(row=>{
            const changes=Array.isArray(row.changes)?row.changes:[];
            const title="Perubahan";
            const changeHtml=changes.length?`<div>${changes.map(c=>`<div class="document-history-change"><b>${escapeDocumentHistoryText(c.field)}</b><span>Sebelum: ${escapeDocumentHistoryText(c.before)}</span><span>Sesudah: ${escapeDocumentHistoryText(c.after)}</span></div>`).join("")}</div>`:"";
            return `<div class="document-history-event"><div class="document-history-event-head"><span class="document-history-event-title">${title}</span><span class="document-history-event-meta">${escapeDocumentHistoryText(row.created_at||"-")} · ${escapeDocumentHistoryText(row.created_by_name||"-")}</span></div>${changeHtml}</div>`;
        }).join("");
    }catch(e){body.innerHTML=`<div class="document-history-empty">Gagal mengambil riwayat: ${escapeDocumentHistoryText(e.message)}</div>`}
}
function escapeDocumentHistoryText(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
