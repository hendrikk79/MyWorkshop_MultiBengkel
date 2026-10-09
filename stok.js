
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
// =========================================================
// MYWORKSHOP - STOK SPAREPART
// =========================================================
(function(){
    "use strict";

    const IN_KEY = myWorkshopScopedStorageKey("myworkshop_sparepart_stock_in");
    const OUT_KEY = myWorkshopScopedStorageKey("myworkshop_sparepart_stock_out");
    const PAGE_SIZE = 10;
    let stockRows = [];
    let stockOutRows = [];
    let inPage = 1;
    let outPage = 1;
    let modalMode = "in";

    const el = id => document.getElementById(id);
    const fmtMoney = value => new Intl.NumberFormat("id-ID", {style:"currency", currency:"IDR", maximumFractionDigits:0}).format(Number(value)||0);
    const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const today = () => new Date().toISOString().slice(0,10);
    const num = v => Number(v) || 0;


    // Halaman Stok Sparepart tidak memuat app.js, sehingga helper global
    // harus tersedia langsung di halaman ini. Tampilan sukses disamakan
    // dengan modal sukses Estimasi: ceklis hijau, animasi, tanpa tombol OKE.
    function ensureStockMessageHelpers(){
        if(typeof window.myWorkshopAlert !== "function"){
            window.myWorkshopAlert = function(message, type = "error"){
                return new Promise(function(resolve){
                    const old=document.getElementById("mwStockMessageModal");
                    if(old) old.remove();
                    const isSuccess=String(type||"").toLowerCase()==="success";
                    const modal=document.createElement("div");
                    modal.id="mwStockMessageModal";
                    modal.style.cssText="position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";
                    const box=document.createElement("div");
                    box.style.cssText="width:min(460px,100%);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:28px;box-sizing:border-box;text-align:center;";
                    const icon=document.createElement("div");
                    icon.style.cssText=`width:68px;height:68px;border-radius:50%;background:${isSuccess?"#22c55e":"#2563eb"};display:flex;align-items:center;justify-content:center;margin:0 auto 15px;box-shadow:0 6px 18px rgba(34,197,94,.28);${isSuccess?"animation:mwStockSuccessPop .35s ease-out;":""}`;
                    icon.innerHTML=isSuccess
                        ? '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span style="color:#fff;font-size:28px;font-weight:800;line-height:1">i</span>';
                    const title=document.createElement("div");
                    title.textContent=isSuccess?"Berhasil":"Informasi";
                    title.style.cssText=`font-size:20px;font-weight:700;color:${isSuccess?"#15803d":"#111827"};margin-bottom:9px;`;
                    const body=document.createElement("div");
                    body.textContent=String(message??"");
                    body.style.cssText="font-size:14px;color:#334155;line-height:1.55;white-space:pre-line;word-break:break-word;";
                    box.appendChild(icon); box.appendChild(title); box.appendChild(body);
                    if(!document.getElementById("mwStockSuccessPopStyle")){
                        const style=document.createElement("style");
                        style.id="mwStockSuccessPopStyle";
                        style.textContent="@keyframes mwStockSuccessPop{0%{transform:scale(.55);opacity:.2}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}";
                        document.head.appendChild(style);
                    }
                    modal.appendChild(box); document.body.appendChild(modal);
                    const close=()=>{if(modal.isConnected) modal.remove();resolve(true);};
                    if(isSuccess) setTimeout(close,1500);
                    else {
                        modal.addEventListener("click",e=>{if(e.target===modal)close();});
                        const button=document.createElement("button");
                        button.type="button"; button.textContent="OK";
                        button.style.cssText="margin-top:20px;border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;padding:9px 24px;font-weight:700;cursor:pointer;";
                        box.appendChild(button); button.addEventListener("click",close); button.focus();
                    }
                });
            };
        }
        if(typeof window.myWorkshopConfirm !== "function"){
            window.myWorkshopConfirm=function(message){
                return new Promise(function(resolve){
                    const old=document.getElementById("mwStockConfirmModal");
                    if(old) old.remove();
                    const modal=document.createElement("div");
                    modal.id="mwStockConfirmModal";
                    modal.style.cssText="position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";
                    modal.innerHTML=`<div style="width:min(420px,100%);background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;box-sizing:border-box"><div style="font-size:19px;font-weight:700;color:#111827;margin-bottom:9px">Konfirmasi Hapus</div><div style="font-size:14px;color:#4b5563;line-height:1.55;margin-bottom:20px">${esc(message)}</div><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-cancel style="border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:7px;padding:9px 16px;cursor:pointer">Batal</button><button type="button" data-ok style="border:0;background:#dc2626;color:#fff;border-radius:7px;padding:9px 16px;font-weight:700;cursor:pointer">Hapus</button></div></div>`;
                    document.body.appendChild(modal);
                    const finish=value=>{if(modal.isConnected)modal.remove();resolve(value);};
                    modal.querySelector("[data-cancel]")?.addEventListener("click",()=>finish(false));
                    modal.querySelector("[data-ok]")?.addEventListener("click",()=>finish(true));
                    modal.addEventListener("click",e=>{if(e.target===modal)finish(false);});
                });
            };
        }
    }
    ensureStockMessageHelpers();

    function readLocal(key){ try{ const x=JSON.parse(localStorage.getItem(key)||"[]"); return Array.isArray(x)?x:[]; }catch(_){ return []; } }
    function setLocal(key, rows){ localStorage.setItem(key, JSON.stringify(rows)); }

    function stockBalance(partNumber){
        const code=String(partNumber||"");
        const masuk=stockRows.filter(x=>String(x.part_number||x.kode||"")===code).reduce((s,x)=>s+num(x.quantity??x.qty),0);
        const keluar=stockOutRows.filter(x=>String(x.part_number||x.kode||"")===code).reduce((s,x)=>s+num(x.quantity??x.qty),0);
        return masuk-keluar;
    }

    // Mengalokasikan Barang Keluar ke stok masuk secara FIFO agar Qty pada
    // setiap baris Barang Masuk benar-benar berkurang sesuai pemakaian.
    function stockRemainingMap(){
        const remainingOut=new Map();
        stockOutRows.forEach(x=>{
            const code=String(x.part_number||x.kode||"");
            remainingOut.set(code,(remainingOut.get(code)||0)+num(x.quantity??x.qty));
        });
        const rows=[...stockRows].sort((a,b)=>{
            const da=String(a.entry_date||a.tanggal||"");
            const db=String(b.entry_date||b.tanggal||"");
            return da.localeCompare(db)||num(a.id)-num(b.id);
        });
        const result=new Map();
        rows.forEach(x=>{
            const id=String(x.id??x.local_id??"");
            const code=String(x.part_number||x.kode||"");
            const original=num(x.quantity??x.qty);
            const out=remainingOut.get(code)||0;
            const used=Math.min(original,Math.max(0,out));
            result.set(id,Math.max(0,original-used));
            remainingOut.set(code,Math.max(0,out-used));
        });
        return result;
    }
    function stockRowRemaining(x,map){
        const id=String(x.id??x.local_id??"");
        return map.has(id)?map.get(id):num(x.quantity??x.qty);
    }

    async function loadRows(){
        let apiIn=[], apiOut=[];
        try{ const r=await fetch("/api/stok-sparepart",{cache:"no-store"}); const j=await r.json(); if(r.ok&&j?.success&&Array.isArray(j.data))apiIn=j.data; }catch(_){}
        try{ const r=await fetch("/api/stok-sparepart/barang-keluar",{cache:"no-store"}); const j=await r.json(); if(r.ok&&j?.success&&Array.isArray(j.data))apiOut=j.data; }catch(_){}
        stockRows=apiIn;
        stockOutRows=apiOut;
        const inMax=Math.max(1,Math.ceil(filteredIn().length/PAGE_SIZE)); const outMax=Math.max(1,Math.ceil(filteredOut().length/PAGE_SIZE));
        inPage=Math.min(inPage,inMax); outPage=Math.min(outPage,outMax);
        render();
    }


    function filteredIn(){
        const q=String(el("stockSearch")?.value||"").trim().toLowerCase();
        return stockRows.filter(x=>[x.part_number,x.part_name,x.supplier,x.vehicle_brand,x.vehicle_type,x.vehicle_year,x.notes].some(v=>String(v||"").toLowerCase().includes(q)));
    }
    function filteredOut(){
        const q=String(el("stockOutSearch")?.value||"").trim().toLowerCase();
        return stockOutRows.filter(x=>[x.part_number,x.part_name,x.supplier,x.vehicle_brand,x.vehicle_type,x.vehicle_year,x.reference,x.notes].some(v=>String(v||"").toLowerCase().includes(q)));
    }

    function render(){ renderIn(); renderOut(); }
    function renderIn(){
        const rows=filteredIn(); const start=(inPage-1)*PAGE_SIZE; const pageRows=rows.slice(start,start+PAGE_SIZE); const body=el("stockTableBody");
        const remainingMap=stockRemainingMap();
        body.innerHTML=pageRows.length?pageRows.map((x,i)=>{
            const remaining=stockRowRemaining(x,remainingMap);
            return `<tr><td>${start+i+1}</td><td>${esc(formatDate(x.entry_date||x.tanggal))}</td><td>${esc(x.part_number||x.kode||"-")}</td><td>${esc(x.part_name||x.nama||"-")}</td><td><strong>${esc(remaining)}</strong></td><td>${esc(x.unit||"PCS")}</td><td>${fmtMoney(x.purchase_price??x.harga_beli??0)}</td><td>${esc(x.supplier||"-")}</td><td>${esc(x.vehicle_brand||"-")}</td><td>${esc(x.vehicle_type||"-")}</td><td>${esc(x.vehicle_year||"-")}</td><td>${esc(x.notes||x.keterangan||"-")}</td><td><button type="button" class="btn-secondary mw-delete-button" style="height:32px;padding:0 10px" onclick="hapusBarangMasuk('${esc(String(x.id??""))}')">Hapus</button></td></tr>`;
        }).join(""):'<tr><td colspan="13" class="stock-empty">Belum ada data Barang Masuk.</td></tr>';
        renderPagination("stockPagination",rows.length,inPage,p=>{inPage=p;renderIn();});
    }
    function renderOut(){
        const rows=filteredOut(); const start=(outPage-1)*PAGE_SIZE; const pageRows=rows.slice(start,start+PAGE_SIZE); const body=el("stockOutTableBody");
        body.innerHTML=pageRows.length?pageRows.map((x,i)=>`<tr><td>${start+i+1}</td><td>${esc(formatDate(x.exit_date||x.tanggal))}</td><td>${esc(x.part_number||x.kode||"-")}</td><td>${esc(x.part_name||x.nama||"-")}</td><td>${esc(x.quantity??x.qty??0)}</td><td>${esc(x.unit||"PCS")}</td><td>${fmtMoney(x.purchase_price??x.harga_beli??0)}</td><td>${esc(x.supplier||"-")}</td><td>${esc(x.vehicle_brand||"-")}</td><td>${esc(x.vehicle_type||"-")}</td><td>${esc(x.vehicle_year||"-")}</td><td>${esc([x.reference,x.notes].filter(Boolean).join(" — ")||"-")}</td><td><button type="button" class="btn-secondary mw-delete-button" style="height:32px;padding:0 10px" onclick="hapusBarangKeluar('${esc(String(x.id??""))}')">Hapus</button></td></tr>`).join(""):'<tr><td colspan="13" class="stock-empty">Belum ada data Barang Keluar.</td></tr>';
        renderPagination("stockOutPagination",rows.length,outPage,p=>{outPage=p;renderOut();});
    }
    function renderPagination(id,total,page,setPage){
        const box=el(id); const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
        if(total<=PAGE_SIZE){box.innerHTML="";return;}
        box.innerHTML=`<button type="button" class="stock-page-btn" ${page<=1?"disabled":""} data-page-prev>‹ Sebelumnya</button><span class="stock-page-info">Halaman ${page} / ${pages}</span><button type="button" class="stock-page-btn" ${page>=pages?"disabled":""} data-page-next>Berikutnya ›</button>`;
        box.querySelector("[data-page-prev]")?.addEventListener("click",()=>setPage(Math.max(1,page-1)));
        box.querySelector("[data-page-next]")?.addEventListener("click",()=>setPage(Math.min(pages,page+1)));
    }

    function formatDate(v){ if(!v)return "-"; const p=String(v).split("-"); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:String(v); }

    function populatePartOptions(){
        const list=el("stockPartOptions");
        if(!list)return;
        const map=new Map();
        stockRows.forEach(x=>{const code=String(x.part_number||x.kode||"").trim();if(!code)return;if(!map.has(code))map.set(code,x);});
        list.innerHTML=Array.from(map.entries()).map(([code,x])=>`<option value="${esc(code)}">${esc(x.part_name||x.nama||"")}</option>`).join("");
    }

    function openModal(mode){
        modalMode=mode; populatePartOptions(); el("stockModal").classList.add("show"); el("stockModalTitle").textContent=mode==="in"?"Barang Masuk":"Barang Keluar"; el("btnSaveStock").textContent=mode==="in"?"Simpan Barang Masuk":"Simpan Barang Keluar"; el("stockReferenceGroup").style.display=mode==="in"?"none":"block"; el("stockForm").reset(); el("stockDate").value=today(); el("stockUnit").value="PCS"; el("stockPurchasePrice").value="0"; el("stockVehicleBrand").value=""; el("stockVehicleType").value=""; el("stockVehicleYear").value=""; el("stockCurrentInfo").textContent=mode==="out"?"Stok tersedia: -":""; setTimeout(()=>el("stockPartNumber")?.focus(),50);
    }
    function closeModal(){el("stockModal").classList.remove("show");el("stockForm").reset();}

    function fillPart(code){
        const rows=stockRows.filter(x=>String(x.part_number||x.kode||"")===String(code)); const x=rows[0];
        if(!x){el("stockPartName").value="";el("stockUnit").value="PCS";el("stockPurchasePrice").value="0";el("stockSupplier").value="";el("stockVehicleBrand").value="";el("stockVehicleType").value="";el("stockVehicleYear").value="";el("stockCurrentInfo").textContent=modalMode==="out"?"Stok tersedia: 0":"";return;}
        el("stockPartName").value=x.part_name||x.nama||""; el("stockUnit").value=x.unit||"PCS"; el("stockPurchasePrice").value=num(x.purchase_price??x.harga_beli); el("stockSupplier").value=x.supplier||"";
        el("stockVehicleBrand").value=x.vehicle_brand||x.merek_mobil||"";
        el("stockVehicleType").value=x.vehicle_type||x.jenis_mobil||"";
        el("stockVehicleYear").value=x.vehicle_year||x.tahun_mobil||"";
        el("stockCurrentInfo").textContent=modalMode==="out"?`Stok tersedia: ${stockBalance(code)} ${x.unit||"PCS"}`:"";
    }

    async function save(event){
        event.preventDefault();
        const code=el("stockPartNumber").value.trim();
        const common={part_number:code,part_name:el("stockPartName").value.trim(),quantity:num(el("stockQty").value),unit:el("stockUnit").value.trim()||"PCS",purchase_price:num(el("stockPurchasePrice").value),supplier:el("stockSupplier").value.trim(),vehicle_brand:el("stockVehicleBrand").value.trim(),vehicle_type:el("stockVehicleType").value.trim(),vehicle_year:el("stockVehicleYear").value.trim(),notes:el("stockNotes").value.trim()};
        const payload=modalMode==="in"?{entry_date:el("stockDate").value,...common}:{exit_date:el("stockDate").value,...common,reference:el("stockReference").value.trim()};
        if(!payload.entry_date&&!payload.exit_date||!payload.part_number||!payload.part_name||!(payload.quantity>0)){myWorkshopAlert("Tanggal, Sparepart dan Jumlah wajib diisi.");return;}
        if(modalMode==="out"&&payload.quantity>stockBalance(code)+1e-9){myWorkshopAlert(`Stok ${code} tidak mencukupi. Stok tersedia: ${stockBalance(code)}.`);return;}
        try{
            const user=JSON.parse(localStorage.getItem("myworkshop_user")||"null"); if(user?.id)payload.created_by=user.id;
            const url=modalMode==="in"?"/api/stok-sparepart/barang-masuk":"/api/stok-sparepart/barang-keluar";
            const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok||!j?.success)throw new Error(j?.message||"Gagal menyimpan transaksi.");
            closeModal(); await loadRows(); myWorkshopAlert(modalMode==="in"?"Barang Masuk berhasil disimpan.":"Barang Keluar berhasil disimpan.", "success");
        }catch(error){
            myWorkshopAlert("Gagal menyimpan transaksi ke database pusat.\n\n" + error.message);
        }
    }

    async function printStockPdf(){
        const rows=[...stockRows];
        const remainingMap=stockRemainingMap();
        const escHtml=v=>esc(v);
        const money=v=>fmtMoney(v);
        const dateText=new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date());
        const body=rows.length?rows.map((x,i)=>{
            const remaining=stockRowRemaining(x,remainingMap);
            return `<tr><td class="no">${i+1}</td><td>${escHtml(formatDate(x.entry_date||x.tanggal))}</td><td>${escHtml(x.part_number||x.kode||"-")}</td><td>${escHtml(x.part_name||x.nama||"-")}</td><td class="num">${escHtml(remaining)}</td><td>${escHtml(x.unit||"PCS")}</td><td class="money">${money(x.purchase_price??x.harga_beli??0)}</td><td>${escHtml(x.supplier||"-")}</td><td>${escHtml(x.vehicle_brand||"-")}</td><td>${escHtml(x.vehicle_type||"-")}</td><td>${escHtml(x.vehicle_year||"-")}</td><td>${escHtml(x.notes||x.keterangan||"-")}</td></tr>`;
        }).join(""):'<tr><td colspan="12" class="empty">Belum ada data Barang Masuk.</td></tr>';
        const workshopHeader=await getWorkshopPrintHeader();
        const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>MyWorkshop</title><style>
            @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:9px}.header{border-bottom:0;padding-bottom:7px;margin-bottom:9px}.name{font-size:16px;font-weight:700}.sub{font-size:10px;margin-top:2px}.title{text-align:center;font-size:14px;font-weight:700;margin:9px 0 3px}.date{text-align:center;font-size:9px;color:#555;margin-bottom:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:4px 5px;vertical-align:top}th{font-weight:700;text-align:left;background:#f3f4f6}.no{text-align:center;width:24px}.num{text-align:right;white-space:nowrap}.money{text-align:right;white-space:nowrap}.empty{text-align:center;padding:18px}.footer{margin-top:8px;text-align:right;font-size:8px;color:#666}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
        </style></head><body>${workshopHeader}<div class="title">STOK SPAREPART</div><div class="date">Seluruh data dari Data Sparepart Masuk — ${escHtml(dateText)}</div><table><thead><tr><th>No</th><th>Tanggal</th><th>Kode Sparepart</th><th>Nama Sparepart</th><th>Qty Sisa</th><th>Satuan</th><th>Harga Beli</th><th>Supplier</th><th>Merek Mobil</th><th>Jenis Mobil</th><th>Tahun Mobil</th><th>Keterangan</th></tr></thead><tbody>${body}</tbody></table><div class="footer">Total data: ${rows.length} baris</div><script>window.onload=function(){setTimeout(function(){window.print()},250)};<\/script></body></html>`;
        const w=window.open("","_blank","width=1200,height=850");
        if(!w){myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak PDF Stok Sparepart.");return;}
        w.document.write(html);w.document.close();
    }

    window.hapusBarangMasuk=async function(id){if(!(await myWorkshopConfirm("Hapus data Barang Masuk ini?")))return;try{const r=await fetch("/api/stok-sparepart/barang-masuk/"+encodeURIComponent(id),{method:"DELETE"});const j=await r.json().catch(()=>({}));if(!r.ok||j?.success===false)throw new Error(j?.message||"Gagal menghapus.");await loadRows();await myWorkshopAlert("Barang Masuk berhasil dihapus.", "success");}catch(e){myWorkshopAlert("Gagal menghapus Barang Masuk.\n\n"+e.message);}};
    window.hapusBarangKeluar=async function(id){if(!(await myWorkshopConfirm("Hapus data Barang Keluar ini?")))return;try{const r=await fetch("/api/stok-sparepart/barang-keluar/"+encodeURIComponent(id),{method:"DELETE"});const j=await r.json().catch(()=>({}));if(!r.ok||j?.success===false)throw new Error(j?.message||"Gagal menghapus.");await loadRows();await myWorkshopAlert("Barang Keluar berhasil dihapus.", "success");}catch(e){myWorkshopAlert("Gagal menghapus Barang Keluar.\n\n"+e.message);}};

    document.addEventListener("DOMContentLoaded",()=>{
        el("currentDate").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date());
        el("stockSearch")?.addEventListener("input",()=>{inPage=1;renderIn();});
        el("stockOutSearch")?.addEventListener("input",()=>{outPage=1;renderOut();});
        el("btnTambahBarangMasuk")?.addEventListener("click",()=>openModal("in"));
        el("btnTambahBarangKeluar")?.addEventListener("click",()=>openModal("out"));
        el("btnPrintStockPdf")?.addEventListener("click",printStockPdf);
        el("stockPartNumber")?.addEventListener("input",e=>fillPart(e.target.value));
        el("btnCloseStock")?.addEventListener("click",closeModal); el("btnCancelStock")?.addEventListener("click",closeModal); el("stockForm")?.addEventListener("submit",save);
        loadRows();
    });
})();
