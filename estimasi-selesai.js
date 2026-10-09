
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
let estimasiSelesaiData = [];
const ES_EST_KEY = myWorkshopScopedStorageKey("myworkshop_estimasi");
const ES_WO_KEY = myWorkshopScopedStorageKey("myworkshop_wo");
const ES_BILL_KEY = myWorkshopScopedStorageKey("myworkshop_tagihan_kuitansi");

function esEl(id){ return document.getElementById(id); }
function esNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function esRupiah(v){ return 'Rp ' + esNum(v).toLocaleString('id-ID',{maximumFractionDigits:2}); }
function esEsc(v){ return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function esText(...values){
    for(const value of values){
        if(value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "-";
}
function esDate(v){
    if(!v) return "-";
    const d = new Date(String(v).replace(" ","T"));
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function esJson(key){ try { const x=JSON.parse(localStorage.getItem(key)||"null"); return Array.isArray(x)?x:[]; } catch(_) { return []; } }
function esId(x){ return String(x?.id ?? x?.estimate_id ?? x?.estimateId ?? ""); }
function esNo(x){ return String(x?.estimate_number ?? x?.number ?? x?.estimateNumber ?? ""); }
function esPayable(x){
    const direct=x?.payable_amount ?? x?.payableAmount;
    if(direct!==undefined&&direct!==null&&direct!=="") return esNum(direct);
    const grand=esNum(x?.grand_total ?? x?.grandTotal ?? x?.total_billed ?? x?.totalBilled);
    const percent=x?.payable_percent ?? x?.payablePercent;
    return percent===undefined||percent===null||percent==="" ? grand : grand*esNum(percent)/100;
}
function normalizeEs(x){
    return {
        ...x,
        id:x.id??x.estimate_id,
        estimate_number:esNo(x),
        estimate_date:x.estimate_date??x.date??x.estimateDate,
        customer_name:x.customer_name??x.customerName,
        plate_number:x.plate_number??x.plateNumber??x.plate,
        insurer_name:x.insurer_name??x.insurerName??x.insurer,
        insurer_alias:x.insurer_alias??x.insurerAlias??x.alias??"",
        claim_number:x.kuitansi_claim_number??x.claim_number??x.claimNumber,
        polis_number:x.kuitansi_polis_number??x.polis_number??x.polisNumber,
        wo_id:x.wo_id??x.woId,
        wo_number:x.wo_number??x.noWO,
        vehicle_name:x.vehicle_name??[x.brand,x.model].filter(Boolean).join(" "),
        kuitansi_id:x.kuitansi_id??x.kuitansiId,
        kuitansi_grand_total:esNum(x.kuitansi_grand_total??x.grand_total_kuitansi??x.kuitansiGrandTotal),
        payable_amount:esPayable(x),
        spareparts:Array.isArray(x?.spareparts)?x.spareparts:[],
        jasa:Array.isArray(x?.jasa)?x.jasa:[],
        jasaLain:Array.isArray(x?.jasaLain)?x.jasaLain:(Array.isArray(x?.jasa_lain)?x.jasa_lain:[]),
        payment_paid_at:x.payment_paid_at??x.paid_at??x.paidAt??"",
        status:x.payment_paid_at??x.paid_at??x.paidAt ? "DIBAYAR" : "MENUNGGU PEMBAYARAN"
    };
}

function loadLocalDone(){
    const ests=esJson(ES_EST_KEY), wos=esJson(ES_WO_KEY), bills=esJson(ES_BILL_KEY);
    const doneIds=new Set(esJson(myWorkshopScopedStorageKey("myworkshop_estimasi_selesai")).map(String));
    const woMap=new Map(wos.map(w=>[String(w?.estimate_id??w?.estimasiId??w?.estimateId??""),w]));
    return ests.filter(e=>String(e?.status||"").toUpperCase()==="SELESAI"||doneIds.has(String(esId(e)))).map(e=>{
        const w=woMap.get(esId(e));
        const bill=bills.find(b=>String(b?.wo_id)===String(w?.id??w?.wo_id??""));
        return normalizeEs({
            ...e,...(w||{}),...(bill||{}),
            estimate_number:esNo(e), customer_name:e.customerName??e.customer_name,
            plate_number:e.plateNumber??e.plate_number, insurer_name:e.insurerName??e.insurer_name,
            claim_number:e.claimNumber??e.claim_number, polis_number:e.polisNumber??e.polis_number,
            wo_number:w?.wo_number??w?.noWO??bill?.wo_number
        });
    });
}

async function loadDone(){
    try{
        const [doneResponse,paymentResponse]=await Promise.all([
            fetch("/api/estimasi-selesai",{cache:"no-store"}),
            fetch("/api/pembayaran",{cache:"no-store"})
        ]);

        const doneJson=await doneResponse.json();
        if(!doneResponse.ok||doneJson?.success===false){
            throw new Error(doneJson?.message||`HTTP ${doneResponse.status}`);
        }

        let payments=[];
        try{
            const paymentJson=await paymentResponse.json();
            if(paymentResponse.ok && paymentJson?.success!==false && Array.isArray(paymentJson?.data)){
                payments=paymentJson.data;
            }
        }catch(paymentError){
            console.warn("Daftar Pembayaran tidak dapat dibaca, menggunakan data pembayaran dari Estimasi Selesai.",paymentError);
        }

        const paymentByWo=new Map();
        payments.forEach(p=>{
            const woId=String(p?.wo_id??p?.woId??"").trim();
            const paidAt=p?.paid_at??p?.payment_paid_at??p?.tanggal_bayar??p?.paidAt??"";
            if(woId && paidAt) paymentByWo.set(woId,paidAt);
        });

        estimasiSelesaiData=Array.isArray(doneJson.data)
            ? doneJson.data.map(row=>{
                const woId=String(row?.wo_id??row?.woId??"").trim();
                const paidAt=row?.payment_paid_at??row?.paid_at??row?.paidAt??paymentByWo.get(woId)??"";
                return normalizeEs({...row,payment_paid_at:paidAt});
            })
            : [];
    }catch(e){
        console.error("Gagal mengambil Estimasi Selesai dari database pusat:",e);
        estimasiSelesaiData=[];
    }
    renderEs();
}

function renderEs(){
    const body=esEl("estimasiSelesaiBody"); if(!body)return;
    const q=String(esEl("searchEstimasiSelesai")?.value||"").trim().toLowerCase();
    const rows=estimasiSelesaiData.filter(x=>[esNo(x),x.wo_number,x.customer_name,x.plate_number,(x.insurer_alias||x.insurerAlias||x.insurer_name),x.claim_number,x.polis_number].join(" ").toLowerCase().includes(q));
    if(!rows.length){body.innerHTML='<tr><td colspan="11" class="es-empty">Belum ada Estimasi Selesai.</td></tr>';return;}
    body.innerHTML=rows.map((x,i)=>{
        const paid=Boolean(x.payment_paid_at);
        const statusText=paid ? `Dibayar Tanggal ${esDate(x.payment_paid_at)}` : "Menunggu Pembayaran";
        return `<tr><td>${i+1}</td><td><strong>${esEsc(esNo(x)||"-")}</strong></td><td>${esEsc(x.wo_number||"-")}</td><td>${esDate(x.estimate_date)}</td><td>${esEsc(x.customer_name||"-")}</td><td>${esEsc(x.plate_number||"-")}</td><td>${esEsc(x.insurer_alias||"-")}</td><td>${esEsc(x.claim_number||"-")}</td><td>${esEsc(x.polis_number||"-")}</td><td><span class="es-status ${paid?"es-status-paid":"es-status-waiting"}">${esEsc(statusText)}</span></td><td><button type="button" class="btn-secondary btn-small" onclick="openEsDetail('${esEsc(esId(x))}')">Detail</button></td></tr>`;
    }).join("");
}

function itemText(item, type){
    if(type==="sparepart"){
        const name=item?.name??item?.part_name??item?.sparepart_name??"-";
        const sku=item?.sku??item?.part_number??item?.code??"";
        const qty=item?.qty??item?.quantity;
        return `${name}${sku?` — SKU: ${sku}`:""}${qty!==undefined&&qty!==null&&qty!==""?` — Qty: ${qty}`:""}`;
    }
    if(type==="jasa"){
        const panel=item?.panel??item?.panel_name??item?.nama_panel??"-";
        const jenis=item?.jenis??item?.service_type??item?.service_name??"";
        const qty=item?.qty??item?.quantity;
        return `${panel}${jenis?` — ${jenis}`:""}${qty!==undefined&&qty!==null&&qty!==""?` — Qty: ${qty}`:""}`;
    }
    const name=item?.name??item?.service_name??item?.nama_jasa??item?.description??"-";
    const qty=item?.qty??item?.quantity;
    return `${name}${qty!==undefined&&qty!==null&&qty!==""?` — Qty: ${qty}`:""}`;
}

function sectionHtml(title, items, type){
    const arr = Array.isArray(items) ? items : [];
    let content = '<div class="es-no-item">Tidak ada.</div>';
    if(arr.length){
        content = '<ol>' + arr.map(i => '<li>' + esEsc(itemText(i,type)) + '</li>').join('') + '</ol>';
    }
    return '<section class="es-work-section"><h3>' + esEsc(title) + '</h3>' + content + '</section>';
}

async function openEsDetail(id){
    const x=estimasiSelesaiData.find(v=>String(esId(v))===String(id));
    if(!x)return;

    const detail=esEl("esDetail");
    const modal=esEl("esModal");
    const printBtn=esEl("esPrintBtn");
    if(!detail)return;

    if(modal) modal.classList.add("show");
    detail.innerHTML='<div style="padding:20px;text-align:center;color:#64748b">Mengambil detail estimasi dan tagihan kuitansi...</div>';
    if(printBtn) printBtn.disabled=true;

    try{
        // Detail estimasi = sumber utama detail pengerjaan.
        // WO dan Tagihan Kuitansi diambil terpisah karena endpoint detail estimasi
        // memang hanya mengembalikan data estimasi + item pengerjaan.
        const responses=await Promise.all([
            fetch(`/api/estimasi/${encodeURIComponent(id)}`,{cache:"no-store"}),
            fetch("/api/wo",{cache:"no-store"})
        ]);

        const jsons=await Promise.all(responses.map(async r=>{
            const j=await r.json().catch(()=>({}));
            if(!r.ok||j?.success===false) throw new Error(j?.message||`HTTP ${r.status}`);
            return j;
        }));

        const estimateJson=jsons[0];
        const woJson=jsons[1];
        if(!estimateJson?.data) throw new Error("Detail estimasi tidak ditemukan.");

        const d=normalizeEs({...x,...(estimateJson.data||{})});
        d.claim_number=esText(x.claim_number,x.claimNumber,d.claim_number);
        d.polis_number=esText(x.polis_number,x.polisNumber,d.polis_number);
        d.insurer_name=esText(x.insurer_name,x.insurerName,d.insurer_name);
        const woList=Array.isArray(woJson?.data)?woJson.data:[];

        // Detail endpoint sudah mengembalikan WO + Kuitansi sehingga Service Advisor
        // tidak perlu meminta endpoint Billing (/api/tagihan-kuitansi).
        const wo=woList.find(w=>
            String(w?.id??"")===String(d.wo_id??"") ||
            String(w?.estimate_id??"")===String(id) ||
            String(w?.estimate_number??"")===String(d.estimate_number??"")
        );

        if(wo){
            d.wo_id=wo.id??d.wo_id;
            d.wo_number=wo.wo_number??wo.noWO??d.wo_number;
        }

        d.kuitansi_id=d.kuitansi_id??null;
        d.kuitansi_grand_total=esNum(d.kuitansi_grand_total);
        d.claim_number=esText(d.kuitansi_claim_number,d.claim_number,x.claim_number,x.claimNumber);
        d.polis_number=esText(d.kuitansi_polis_number,d.polis_number,x.polis_number,x.polisNumber);
        d.insurer_name=esText(d.insurer_name,x.insurer_name,x.insurerName);
        d.own_risk=esNum(d.own_risk);

        const kendaraan=[
            d.plate_number,
            [d.brand,d.model].filter(Boolean).join(" "),
            d.year?`Tahun ${d.year}`:""
        ].filter(Boolean).join(" — ") || "-";

        const noPolis=esText(d.polis_number,d.polisNumber,d.kuitansi_polis_number,x.polis_number,x.polisNumber);
        const noKlaim=esText(d.claim_number,d.claimNumber,d.kuitansi_claim_number,x.claim_number,x.claimNumber);
        const grandKuitansi=esNum(d.kuitansi_grand_total);

        detail.innerHTML=`
            <div style="font-size:13px;color:#475569;margin-bottom:14px">Informasi Tagihan Kuitansi</div>
            <div style="border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:14px;margin-bottom:18px">
                <div style="display:grid;grid-template-columns:170px 1fr;row-gap:9px;column-gap:12px;line-height:1.4">
                    <div style="color:#64748b">No. Estimasi</div><div style="font-weight:700;color:#111827">${esEsc(esNo(d)||"-")}</div>
                    <div style="color:#64748b">No. WO</div><div style="font-weight:700;color:#111827">${esEsc(d.wo_number||"-")}</div>
                    <div style="color:#64748b">Customer</div><div style="font-weight:600;color:#111827">${esEsc(d.customer_name||"-")}</div>
                    <div style="color:#64748b">Kendaraan</div><div style="font-weight:600;color:#111827">${esEsc(kendaraan)}</div>
                    <div style="color:#64748b">Asuransi</div><div style="font-weight:600;color:#111827">${esEsc(d.insurer_alias||d.insurerAlias||d.insurer_name||"-")}</div>
                    <div style="color:#64748b">No. Polis</div><div style="font-weight:600;color:#111827">${esEsc(noPolis)}</div>
                    <div style="color:#64748b">No. Klaim</div><div style="font-weight:600;color:#111827">${esEsc(noKlaim)}</div>
                    <div style="color:#64748b">OR</div><div style="font-weight:700;color:#111827">${esEsc(esRupiah(d.own_risk))}</div>
                    <div style="border-top:1px solid #cbd5e1;padding-top:10px;color:#334155;font-weight:700">Grand Total Tagihan Kuitansi</div>
                    <div style="border-top:1px solid #cbd5e1;padding-top:10px;font-size:15px;font-weight:800;color:#111827">${esEsc(esRupiah(grandKuitansi))}</div>
                </div>
            </div>

            <div style="font-size:15px;font-weight:800;color:#111827;margin:0 0 10px">Detail Pengerjaan</div>
            ${sectionHtml("Sparepart",d.spareparts,"sparepart")}
            ${sectionHtml("Jasa Perbaikan / Pengecatan",d.jasa,"jasa")}
            ${sectionHtml("Jasa Lain-lain",d.jasaLain,"lain")}
        `;

        if(printBtn){
            printBtn.disabled=false;
            printBtn.onclick=()=>printEsWorkDetail(d);
        }
    }catch(e){
        console.error("DETAIL ESTIMASI SELESAI ERROR:",e);
        detail.innerHTML=`<div style="padding:18px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">Gagal mengambil detail: ${esEsc(e.message||e)}</div>`;
        if(printBtn){printBtn.disabled=true;printBtn.onclick=null;}
    }
}

function closeEsModal(){esEl("esModal")?.classList.remove("show");}

function printEsWorkDetail(d){
    const win=window.open("","_blank","width=900,height=800");
    if(!win){myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk MyWorkshop.");return;}

    function sectionPrint(title,items,type){
        const arr=Array.isArray(items)?items:[];
        let content='<p>Tidak ada.</p>';
        if(arr.length){
            content='<ol>'+arr.map(i=>'<li>'+esEsc(itemText(i,type))+'</li>').join('')+'</ol>';
        }
        return '<section><h2>'+esEsc(title)+'</h2>'+content+'</section>';
    }

    const kendaraan=[d.plate_number,[d.brand,d.model].filter(Boolean).join(" "),d.year?`Tahun ${d.year}`:""].filter(Boolean).join(" — ") || "-";
    const noPolis=esText(d.polis_number,d.polisNumber,d.kuitansi_polis_number);
    const noKlaim=esText(d.claim_number,d.claimNumber,d.kuitansi_claim_number);
    const grandKuitansi=esNum(d.kuitansi_grand_total);
    const html='<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">'
        +'<title>MyWorkshop</title>'
        +'<style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#111;font-size:12px}'
        +'h1{font-size:20px;margin:0 0 5px}h2{font-size:15px;border-bottom:1px solid #222;padding-bottom:6px;margin:20px 0 8px}'
        +'p,li{line-height:1.6}.head{border-bottom:2px solid #111;padding-bottom:10px}.meta{margin-top:5px;color:#444}'
        +'.summary{border:1px solid #bbb;padding:10px;margin-top:15px}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}.summary-grid div{padding:5px 0;border-bottom:1px solid #eee}.summary-grid span{display:block;font-size:10px;color:#555}.summary-grid strong{display:block;margin-top:3px}.total{grid-column:1/-1;border-top:2px solid #111;margin-top:5px;padding-top:8px;font-size:14px}.footer{margin-top:30px;font-size:10px;color:#666}</style></head><body>'
        +'<div class="head"><h1>Estimasi Selesai</h1><div class="meta">No. Estimasi: <strong>'
        +esEsc(esNo(d)||'-')+'</strong> &nbsp; | &nbsp; No. WO: <strong>'+esEsc(d.wo_number||'-')+'</strong></div></div>'
        +'<div class="summary"><h2 style="margin-top:0">Informasi Tagihan Kuitansi</h2><div class="summary-grid">'
        +'<div><span>Customer</span><strong>'+esEsc(d.customer_name||'-')+'</strong></div>'
        +'<div><span>Kendaraan</span><strong>'+esEsc(kendaraan)+'</strong></div>'
        +'<div><span>Asuransi</span><strong>'+esEsc(d.insurer_alias||d.insurerAlias||d.insurer_name||'-')+'</strong></div>'
        +'<div><span>No. Polis</span><strong>'+esEsc(noPolis)+'</strong></div>'
        +'<div><span>No. Klaim</span><strong>'+esEsc(noKlaim)+'</strong></div>'
        +'<div><span>OR</span><strong>'+esEsc(esRupiah(d.own_risk))+'</strong></div>'
        +'<div class="total"><span>Grand Total Tagihan Kuitansi</span><strong>'+esEsc(esRupiah(grandKuitansi))+'</strong></div>'
        +'</div></div><h2>Detail Pengerjaan</h2>'
        +sectionPrint('Sparepart',d.spareparts,'sparepart')
        +sectionPrint('Jasa Perbaikan / Pengecatan',d.jasa,'jasa')
        +sectionPrint('Jasa Lain-lain',d.jasaLain,'lain')
        +'<div class="footer">Dicetak dari MyWorkshop</div></body></html>';

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(()=>win.print(),300);
}

esEl("searchEstimasiSelesai")?.addEventListener("input",renderEs);
esEl("esModal")?.addEventListener("click",e=>{if(e.target===esEl("esModal"))closeEsModal();});
window.openEsDetail=openEsDetail;
window.closeEsModal=closeEsModal;
document.addEventListener("DOMContentLoaded",()=>{
    if(esEl("currentDate"))esEl("currentDate").textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    loadDone();
});
