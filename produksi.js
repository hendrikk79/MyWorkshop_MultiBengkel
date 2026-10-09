
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
// MYWORKSHOP - VENDOR PRODUKSI
// ==========================================================

const PRODUCTION_LOCAL_KEY = myWorkshopScopedStorageKey("myworkshop_vendor_produksi");
const PRODUCTION_WO_KEY = myWorkshopScopedStorageKey("myworkshop_wo");
const PRODUCTION_EST_KEY = myWorkshopScopedStorageKey("myworkshop_estimasi");

let productionData = [];
let productionFiltered = [];
let productionEditing = null;

function pel(id){ return document.getElementById(id); }

function esc(value){
    return String(value ?? "")
        .replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");
}

function rupiah(value){
    const n = Number(value || 0);
    return "Rp " + n.toLocaleString("id-ID");
}

function statusText(value){ return String(value || "-").trim(); }

function isUnpaidWO(item){
    return !item?.payment_id;
}

const REQUIRED_WORK_TYPES = ["KETOK","DEMPUL","CAT","POLES"];

function productionWorkerState(item){
    const workers = workerList(item);
    const enteredTypes = new Set(
        workers
            .map(worker => String(worker?.worker_type || "").trim().toUpperCase())
            .filter(type => REQUIRED_WORK_TYPES.includes(type))
    );
    const total = workers.reduce((sum, worker) => sum + Number(worker?.worker_price || 0), 0);
    return {
        workers,
        total,
        complete: REQUIRED_WORK_TYPES.every(type => enteredTypes.has(type))
    };
}

function localArray(key){
    try{
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
    }catch(_){ return []; }
}

function saveLocalPrices(data){
    try{ localStorage.setItem(PRODUCTION_LOCAL_KEY, JSON.stringify(data)); }catch(_){ }
}

function localPrices(){ return localArray(PRODUCTION_LOCAL_KEY); }

function priceKey(woId, type){
    return String(woId) + "::" + String(type || "").toUpperCase();
}

function normalizeWorker(item){
    return {
        id: item?.id,
        wo_id: item?.wo_id ?? item?.woId,
        worker_name: item?.worker_name ?? item?.workerName ?? "",
        worker_type: String(item?.worker_type ?? item?.workerType ?? "").toUpperCase(),
        worker_price: Number(item?.worker_price ?? item?.workerPrice ?? 0)
    };
}

function localWorkerMap(){
    const map = {};
    localPrices().forEach(raw => {
        const item = normalizeWorker(raw);
        map[priceKey(item.wo_id,item.worker_type)] = item;
    });
    return map;
}

function enrichLocalWO(){
    const wos = localArray(PRODUCTION_WO_KEY);
    const ests = localArray(PRODUCTION_EST_KEY);
    const pmap = localWorkerMap();

    return wos.filter(isActiveWO).map(w => {
        const estimateId = w.estimate_id ?? w.estimasiId ?? w.estimateId;
        const e = ests.find(x => String(x?.id ?? x?.estimate_id ?? "") === String(estimateId)) || {};
        const vehicle = w.vehicle || e.vehicle || {};
        const customer = w.customer || e.customer || {};
        const id = w.id ?? w.wo_id ?? w.woId ?? estimateId;
        const worker_prices = ["KETOK","DEMPUL","CAT","POLES"]
            .map(type => pmap[priceKey(id,type)])
            .filter(Boolean);
        const getPrice = type => Number(pmap[priceKey(id,type)]?.worker_price || 0);
        return {
            ...w,
            id,
            wo_number: w.wo_number ?? w.noWO ?? w.number ?? "-",
            customer_name: w.customer_name ?? w.customerName ?? customer.name ?? e.customer_name ?? "-",
            plate_number: w.plate_number ?? w.plateNumber ?? vehicle.plate_number ?? vehicle.plateNumber ?? e.plate_number ?? "-",
            brand: w.brand ?? vehicle.brand ?? e.brand ?? "-",
            model: w.model ?? vehicle.model ?? vehicle.type ?? e.model ?? "-",
            year: w.year ?? vehicle.year ?? e.year ?? "-",
            worker_prices,
            ketok_price: getPrice("KETOK"),
            dempul_price: getPrice("DEMPUL"),
            cat_price: getPrice("CAT"),
            poles_price: getPrice("POLES")
        };
    });
}

function workerList(item){
    const list = Array.isArray(item?.worker_prices) ? item.worker_prices.map(normalizeWorker) : [];
    const byType = new Map();
    list.forEach(x => byType.set(x.worker_type,x));
    ["KETOK","DEMPUL","CAT","POLES"].forEach(type => {
        const field = type.toLowerCase() + "_price";
        if(!byType.has(type) && Number(item?.[field] || 0) > 0){
            byType.set(type,{worker_type:type,worker_name:"",worker_price:Number(item[field] || 0)});
        }
    });
    return Array.from(byType.values());
}

async function apiJSON(url, options={}){
    const response = await fetch(url, {
        headers:{"Content-Type":"application/json", ...(options.headers || {})},
        ...options
    });
    let data={};
    try{ data=await response.json(); }catch(_){ }
    if(!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
}

async function loadProduction(){
    try{
        const result = await apiJSON("/api/vendor-produksi");
        const serverData = Array.isArray(result?.data) ? result.data : [];
        const localMap = localWorkerMap();

        productionData = serverData
            .filter(isUnpaidWO)
            .map(item => {
                const id = item.id ?? item.wo_id ?? item.woId;
                const serverWorkers = Array.isArray(item.worker_prices) ? item.worker_prices.map(normalizeWorker) : [];
                const byType = new Map(serverWorkers.map(worker => [String(worker.worker_type || "").toUpperCase(), worker]));

                // Pertahankan data lokal yang pernah tersimpan saat API lama menolak
                // input pada WO CHECK OUT/SELESAI. Data server tetap menjadi prioritas
                // apabila jenis pekerjaan tersebut sudah tersimpan di database.
                REQUIRED_WORK_TYPES.forEach(type => {
                    if(!byType.has(type)){
                        const local = localMap[priceKey(id, type)];
                        if(local) byType.set(type, local);
                    }
                });

                const workers = REQUIRED_WORK_TYPES
                    .map(type => byType.get(type))
                    .filter(Boolean);
                const total = workers.reduce((sum, worker) => sum + Number(worker.worker_price || 0), 0);
                const enteredTypes = new Set(workers.map(worker => String(worker.worker_type || "").toUpperCase()));

                return {
                    ...item,
                    worker_prices: workers,
                    ketok_price: Number(byType.get("KETOK")?.worker_price || 0),
                    dempul_price: Number(byType.get("DEMPUL")?.worker_price || 0),
                    cat_price: Number(byType.get("CAT")?.worker_price || 0),
                    poles_price: Number(byType.get("POLES")?.worker_price || 0),
                    total_worker_price: total,
                    worker_type_count: enteredTypes.size,
                    all_worker_prices_input: REQUIRED_WORK_TYPES.every(type => enteredTypes.has(type))
                };
            });
        productionData.sort((a,b) => Number(b.id || 0) - Number(a.id || 0));
        applyProductionSearch();
    }catch(error){
        productionData = [];
        applyProductionSearch();
        console.error("Gagal mengambil Vendor Produksi dari database pusat:", error);
    }
}
function applyProductionSearch(){
    const q = String(pel("searchProduction")?.value || "").trim().toLowerCase();
    productionFiltered = productionData.filter(item => {
        if(!q) return true;
        const workerText = workerList(item).map(x => `${x.worker_name} ${x.worker_type}`).join(" ");
        return [item.wo_number,item.estimate_number,item.customer_name,item.plate_number,item.brand,item.model,item.status,workerText]
            .some(v => String(v ?? "").toLowerCase().includes(q));
    });
    renderProduction();
}

function renderProduction(){
    const body = pel("productionTableBody");
    if(!body) return;
    if(!productionFiltered.length){
        body.innerHTML = `<tr><td colspan="12" class="production-empty">Tidak ada WO yang belum lunas.</td></tr>`;
        return;
    }
    body.innerHTML = productionFiltered.map((item,index) => {
        const id = item.id ?? item.wo_id ?? item.woId;
        const car = [item.brand,item.model,item.year].filter(v => String(v ?? "").trim() && String(v).trim() !== "-").join(" / ") || "-";
        const state = productionWorkerState(item);
        const total = state.total;
        const paymentButton = state.complete
            ? `<button type="button" class="btn-small production-btn-payment" onclick="openProductionPayment('${esc(id)}')">💰 Pembayaran</button>`
            : `<button type="button" class="btn-small production-btn-payment-disabled" disabled title="Input Ketok, Dempul, Cat, dan Poles terlebih dahulu">💰 Pembayaran</button>`;
        return `<tr>
            <td>${index+1}</td>
            <td><strong>${esc(item.wo_number || "-")}</strong></td>
            <td>${esc(item.customer_name || "-")}</td>
            <td>${esc(item.plate_number || "-")}</td>
            <td>${esc(car)}</td>
            <td>${esc(statusText(item.status))}</td>
            <td class="production-price">${rupiah(item.ketok_price)}</td>
            <td class="production-price">${rupiah(item.dempul_price)}</td>
            <td class="production-price">${rupiah(item.cat_price)}</td>
            <td class="production-price">${rupiah(item.poles_price)}</td>
            <td class="production-price"><strong>${rupiah(total)}</strong></td>
            <td><div class="production-row-actions"><button type="button" class="btn-primary btn-small production-btn-input" onclick="openProductionPrice('${esc(id)}')">Input Harga Pekerja</button>${paymentButton}<button type="button" class="btn-small production-btn-print" onclick="printProduction('${esc(id)}')">Print</button></div></td>
        </tr>`;
    }).join("");
}

function openProductionPrice(id){
    const item = productionData.find(x => String(x.id ?? x.wo_id ?? x.woId) === String(id));
    if(!item) return;
    productionEditing = item;
    pel("productionWOId").value = id;
    pel("productionWONumber").textContent = item.wo_number || "-";
    pel("productionCustomer").textContent = item.customer_name || "-";
    pel("workerName").value = "";
    pel("workerType").value = "";
    pel("workerPrice").value = "";
    pel("productionPriceModal").classList.add("show");
}

function closeProductionPrice(){
    pel("productionPriceModal")?.classList.remove("show");
    productionEditing = null;
}

function findExistingWorker(type){
    if(!productionEditing) return null;
    const t = String(type || "").toUpperCase();
    return workerList(productionEditing).find(x => String(x.worker_type).toUpperCase() === t) || null;
}

function fillExistingPrice(){
    const type = String(pel("workerType")?.value || "").toUpperCase();
    if(!type || !productionEditing){
        pel("workerName").value = "";
        pel("workerPrice").value = "";
        return;
    }
    const existing = findExistingWorker(type);
    pel("workerName").value = existing?.worker_name || "";
    pel("workerPrice").value = existing && Number(existing.worker_price || 0) > 0 ? Number(existing.worker_price) : "";
}

async function saveProductionPrice(event){
    event.preventDefault();
    if(!productionEditing) return;
    const woId = pel("productionWOId").value;
    const workerName = String(pel("workerName").value || "").trim();
    const type = String(pel("workerType").value || "").toUpperCase();
    const price = Number(pel("workerPrice").value);
    if(!workerName){ myWorkshopAlert("Nama pekerja wajib diisi."); return; }
    if(!["KETOK","DEMPUL","CAT","POLES"].includes(type)){ myWorkshopAlert("Jenis pekerjaan wajib dipilih."); return; }
    if(!Number.isFinite(price) || price < 0){ myWorkshopAlert("Harga pekerja tidak valid."); return; }

    const local = localPrices().filter(x => priceKey(x.wo_id ?? x.woId, x.worker_type ?? x.workerType) !== priceKey(woId,type));
    local.push({wo_id: woId, worker_name:workerName, worker_type:type, worker_price:price, updated_at:new Date().toISOString()});
    saveLocalPrices(local);

    try{
        await apiJSON(`/api/vendor-produksi/${encodeURIComponent(woId)}/harga`, {
            method:"POST",
            body:JSON.stringify({worker_name:workerName, worker_type:type, worker_price:price})
        });
    }catch(error){
        console.warn("Harga pekerja disimpan lokal karena API gagal.", error);
    }

    closeProductionPrice();
    await loadProduction();
    myWorkshopAlert("Data pekerja berhasil disimpan.", "success");
}

function openProductionPayment(id){
    const item = productionData.find(x => String(x.id ?? x.wo_id ?? x.woId) === String(id));
    if(!item) return;
    const state = productionWorkerState(item);
    const total = state.total;
    if(!state.complete){
        const entered = new Set(state.workers.map(worker => String(worker?.worker_type || "").trim().toUpperCase()));
        const missing = REQUIRED_WORK_TYPES.filter(type => !entered.has(type));
        myWorkshopAlert(`Harga pekerja belum lengkap. Silakan input: ${missing.join(", ")}.`);
        return;
    }
    productionEditing = item;
    pel("productionPaymentWOId").value = id;
    pel("productionPaymentWONumber").textContent = item.wo_number || "-";
    pel("productionPaymentCustomer").textContent = item.customer_name || "-";
    pel("productionPaymentTotal").textContent = rupiah(total);
    pel("productionPaymentDate").value = new Date().toISOString().slice(0,10);
    pel("productionPaymentDescription").value = "";
    pel("productionPaymentModal").classList.add("show");
}

function closeProductionPayment(){
    pel("productionPaymentModal")?.classList.remove("show");
    productionEditing = null;
}

function productionPaymentConfirm(message){
    return new Promise(function(resolve){
        const existing = document.getElementById("mwProductionPaymentConfirmModal");
        if(existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "mwProductionPaymentConfirmModal";
        modal.style.cssText = "position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";
        modal.innerHTML = `
            <div style="width:min(440px,100%);background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:22px;box-sizing:border-box;">
                <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;text-align:center;">Konfirmasi Pembayaran</div>
                <div style="font-size:14px;color:#374151;line-height:1.55;white-space:pre-line;text-align:center;">${esc(message)}</div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
                    <button type="button" id="mwProductionPaymentCancel" style="border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:7px;padding:9px 16px;cursor:pointer;">Batal</button>
                    <button type="button" id="mwProductionPaymentConfirm" style="border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:7px;padding:9px 16px;font-weight:700;cursor:pointer;">Ya, Simpan / LUNAS</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const finish = function(value){
            modal.remove();
            resolve(value);
        };
        document.getElementById("mwProductionPaymentCancel")?.addEventListener("click",function(){ finish(false); });
        document.getElementById("mwProductionPaymentConfirm")?.addEventListener("click",function(){ finish(true); });
        modal.addEventListener("click",function(event){
            if(event.target === modal) finish(false);
        });
    });
}

async function saveProductionPayment(event){
    event.preventDefault();
    if(!productionEditing) return;
    const woId = pel("productionPaymentWOId").value;
    const paidAt = String(pel("productionPaymentDate").value || "").trim();
    const description = String(pel("productionPaymentDescription").value || "").trim();
    const state = productionWorkerState(productionEditing);
    const total = state.total;
    if(!paidAt){ myWorkshopAlert("Tanggal pembayaran wajib diisi."); return; }
    if(!state.complete){
        const entered = new Set(state.workers.map(worker => String(worker?.worker_type || "").trim().toUpperCase()));
        const missing = REQUIRED_WORK_TYPES.filter(type => !entered.has(type));
        myWorkshopAlert(`Harga pekerja belum lengkap. Silakan input: ${missing.join(", ")}.`);
        return;
    }

    const woNumber = productionEditing.wo_number || "-";
    if(!(await productionPaymentConfirm(`Bayar ${rupiah(total)} untuk WO ${woNumber}?\n\nSetelah disimpan, WO akan berstatus LUNAS dan hilang dari daftar Vendor Produksi.`))) return;

    try{
        // UI dapat memuat harga dari local fallback ketika API sebelumnya gagal.
        // Pastikan seluruh harga yang tampil juga tersimpan di server sebelum pembayaran.
        for(const worker of state.workers){
            const type = String(worker?.worker_type || "").trim().toUpperCase();
            if(!REQUIRED_WORK_TYPES.includes(type)) continue;
            const workerName = String(worker?.worker_name || "").trim();
            const workerPrice = Number(worker?.worker_price);
            if(!workerName){
                throw new Error(`Nama pekerja ${type} wajib diisi sebelum pembayaran.`);
            }
            if(!Number.isFinite(workerPrice) || workerPrice < 0){
                throw new Error(`Harga pekerja ${type} tidak valid.`);
            }
            await apiJSON(`/api/vendor-produksi/${encodeURIComponent(woId)}/harga`, {
                method:"POST",
                body:JSON.stringify({
                    worker_name:workerName,
                    worker_type:type,
                    worker_price:workerPrice
                })
            });
        }

        await apiJSON(`/api/vendor-produksi/${encodeURIComponent(woId)}/pembayaran`, {
            method:"POST",
            body:JSON.stringify({
                paid_at:paidAt,
                description,
                created_by:Number(window.currentUser?.id || window.user?.id || 0) || null
            })
        });
        closeProductionPayment();
        await loadProduction();
        await myWorkshopAlert(`Pembayaran WO ${woNumber} berhasil disimpan sebagai LUNAS.`, "success");
    }catch(error){
        myWorkshopAlert("Pembayaran gagal disimpan.\n\n" + error.message);
    }
}

async function printProduction(id){
    const item = productionData.find(x => String(x.id ?? x.wo_id ?? x.woId) === String(id));
    if(!item) return;
    const workers = workerList(item);
    const date = new Date().toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"});
    const rows = workers.length ? workers.map((w,i)=>`<tr><td>${i+1}</td><td>${esc(w.worker_name || "-")}</td><td>${esc(w.worker_type || "-")}</td><td class="money">${rupiah(w.worker_price)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Belum ada harga pekerja.</td></tr>`;
    const total = workers.reduce((sum,w)=>sum+Number(w.worker_price||0),0);
    const workshopHeader = await getWorkshopPrintHeader();
    const win = window.open("","_blank","width=900,height=700");
    if(!win){ myWorkshopAlert("Popup print diblokir browser. Silakan izinkan popup untuk MyWorkshop."); return; }
    win.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{font-size:12px;color:#555;margin-bottom:22px}.head{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px;margin-bottom:22px}.box{border:1px solid #ddd;padding:10px}.box span{display:block;font-size:11px;color:#666;margin-bottom:4px}.box strong{font-size:13px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:9px;text-align:left;font-size:12px}th{background:#f3f4f6}.money{text-align:right}.total{text-align:right;font-weight:700;margin-top:14px}.sign{margin-top:70px;width:260px;text-align:left}.sign .line{margin-top:70px;border-top:1px solid #111;padding-top:6px}.empty{text-align:center;color:#777}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body>${workshopHeader}<h1>VENDOR PRODUKSI</h1><div class="sub">Daftar Harga Pekerja Produksi &mdash; ${esc(date)}</div><div class="head"><div class="box"><span>No. WO</span><strong>${esc(item.wo_number||"-")}</strong></div><div class="box"><span>Status</span><strong>${esc(statusText(item.status))}</strong></div><div class="box"><span>Customer</span><strong>${esc(item.customer_name||"-")}</strong></div><div class="box"><span>Kendaraan</span><strong>${esc([item.brand,item.model,item.year].filter(Boolean).join(" / ")||"-")}</strong></div><div class="box"><span>No. Polisi</span><strong>${esc(item.plate_number||"-")}</strong></div></div><table><thead><tr><th>No</th><th>Nama Pekerja</th><th>Jenis Pekerjaan</th><th>Harga Pekerja</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total Harga Pekerja: ${rupiah(total)}</div><div class="sign">Authorized Signatory / Stamp<div class="line">Nama / Tanda Tangan</div></div><script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)};<\/script></body></html>`);
    win.document.close();
}

function setCurrentDate(){
    const elDate=pel("currentDate");
    if(!elDate) return;
    elDate.textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"});
}

function initProduction(){
    setCurrentDate();
    pel("searchProduction")?.addEventListener("input",applyProductionSearch);
    pel("workerType")?.addEventListener("change",fillExistingPrice);
    pel("productionPriceForm")?.addEventListener("submit",saveProductionPrice);
    pel("btnCloseProductionModal")?.addEventListener("click",closeProductionPrice);
    pel("btnCancelProduction")?.addEventListener("click",closeProductionPrice);
    pel("productionPriceModal")?.addEventListener("click",e=>{ if(e.target.id==="productionPriceModal") closeProductionPrice(); });
    pel("productionPaymentForm")?.addEventListener("submit",saveProductionPayment);
    pel("btnCloseProductionPayment")?.addEventListener("click",closeProductionPayment);
    pel("btnCancelProductionPayment")?.addEventListener("click",closeProductionPayment);
    pel("productionPaymentModal")?.addEventListener("click",e=>{ if(e.target.id==="productionPaymentModal") closeProductionPayment(); });
    loadProduction().catch(error=>console.error("LOAD VENDOR PRODUKSI ERROR",error));
}

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initProduction,{once:true});
else initProduction();

window.openProductionPrice=openProductionPrice;
window.closeProductionPrice=closeProductionPrice;
window.printProduction=printProduction;
window.openProductionPayment=openProductionPayment;
window.closeProductionPayment=closeProductionPayment;
