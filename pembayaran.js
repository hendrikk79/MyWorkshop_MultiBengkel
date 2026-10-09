const PAYMENT_LOCAL_KEY = "myworkshop_pembayaran_kuitansi";
const PAYMENT_BILL_KEY = "myworkshop_tagihan_kuitansi";
const PAYMENT_WO_KEY = "myworkshop_wo";
const PAYMENT_EST_KEY = "myworkshop_estimasi";
let paymentRows = [];
let currentPayment = null;

function pEl(id){return document.getElementById(id)}
function pEsc(v){return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function pNum(v){const n=Number(v);return Number.isFinite(n)?n:0}
function pRupiah(v){return "Rp "+pNum(v).toLocaleString("id-ID",{maximumFractionDigits:2})}
function pDate(v){if(!v)return "-";const s=String(v).slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split("-");return `${d}/${m}/${y}`;}const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"})}
function pToday(){const d=new Date();const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function pJSON(key,fallback=[]){try{const x=JSON.parse(localStorage.getItem(key)||"null");return Array.isArray(x)?x:fallback}catch(_){return fallback}}
function pId(x){return String(x?.id ?? x?.wo_id ?? "")}
function pEstId(w){return String(w?.estimate_id ?? w?.estimasiId ?? w?.estimateId ?? "")}
function pClaim(row){return String(row?.claim_number ?? row?.claimNumber ?? "").trim()}
function pSaved(){try{const x=JSON.parse(localStorage.getItem(PAYMENT_LOCAL_KEY)||"null");return x&&typeof x==="object"&&!Array.isArray(x)?x:{} }catch(_){return {}}}
function savePSaved(x){localStorage.setItem(PAYMENT_LOCAL_KEY,JSON.stringify(x))}
function api(url,options={}){return fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options}).then(async r=>{let d={};try{d=await r.json()}catch(_){}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d})}

function buildLocalRows(){
    const wos=pJSON(PAYMENT_WO_KEY,[]), ests=pJSON(PAYMENT_EST_KEY,[]), bills=pJSON(PAYMENT_BILL_KEY,[]), payments=pSaved();
    const emap=new Map(ests.map(e=>[String(e?.id??e?.estimate_id??e?.estimasiId??e?.estimateId??""),e]));
    const wmap=new Map(wos.map(w=>[pId(w),w]));
    const rows=[];

    // Jadikan Tagihan Kuitansi sebagai sumber utama daftar pembayaran.
    // Dengan demikian WO tetap muncul walaupun status WO sudah CHECK OUT/SELESAI
    // atau data WO lokal tidak lagi membawa flag kuitansi.
    bills.forEach(bill=>{
        const wid=String(bill?.wo_id??bill?.woId??"");
        if(!wid)return;
        const w=wmap.get(wid)||{};
        const e=emap.get(pEstId(w)) || emap.get(String(bill?.estimate_id??bill?.estimateId??"")) || {};
        const pay=payments[wid]||{};
        rows.push({
            ...e,...w,...bill,wo_id:wid,
            wo_number:w?.wo_number??w?.noWO??bill?.wo_number??bill?.woNumber??"",
            estimate_number:e?.estimate_number??e?.estimateNumber??w?.estimate_number??bill?.estimate_number??bill?.estimateNumber??"",
            claim_number:pClaim(bill)||pClaim(e)||pClaim(w),
            customer_name:w?.customer_name??w?.customerName??e?.customerName??e?.customer_name??bill?.customer_name??bill?.customerName??"",
            plate_number:w?.plate_number??w?.plate??e?.plate_number??e?.plate??bill?.plate_number??bill?.plate??"",
            insurer_name:w?.insurer_name??w?.insurerName??e?.insurerName??e?.insurer_name??bill?.insurer_name??bill?.insurerName??"",
            insurer_alias:w?.insurer_alias??w?.insurerAlias??e?.insurerAlias??e?.insurer_alias??bill?.insurer_alias??bill?.insurerAlias??"",
            kuitansi_number:bill?.kuitansi_number??bill?.kuitansiNumber??w?.kuitansi_number??w?.kuitansiNumber??"",
            grand_total:pNum(bill?.grand_total??bill?.grandTotal??w?.grand_total),
            paid_at:pay.paid_at||pay.paidAt||bill?.paid_at||"",
            payment_description:pay.description||pay.keterangan||bill?.payment_description||bill?.paymentDescription||"",
            payment_id:pay.id||null
        });
    });

    // Kompatibilitas data lama: jika WO mempunyai kuitansi tetapi record bill
    // tidak membawa wo_id secara eksplisit, tetap tampilkan berdasarkan kuitansi_id.
    wos.forEach(w=>{
        const wid=pId(w);
        if(!wid || rows.some(r=>String(r.wo_id)===wid))return;
        const bill=bills.find(b=>String(b?.wo_id)===wid || String(b?.id)===String(w?.kuitansi_id));
        if(!bill && !w?.kuitansi_id)return;
        const e=emap.get(pEstId(w))||{};
        const pay=payments[wid]||{};
        rows.push({
            ...e,...w,...(bill||{}),wo_id:wid,
            wo_number:w?.wo_number??w?.noWO??bill?.wo_number??"",
            estimate_number:e?.estimate_number??e?.estimateNumber??w?.estimate_number??bill?.estimate_number??"",
            claim_number:pClaim(bill)||pClaim(e)||pClaim(w),
            customer_name:w?.customer_name??w?.customerName??e?.customerName??bill?.customer_name??"",
            plate_number:w?.plate_number??w?.plate??e?.plate_number??e?.plate??bill?.plate_number??"",
            insurer_name:w?.insurer_name??w?.insurerName??e?.insurerName??e?.insurer_name??bill?.insurer_name??"",
            insurer_alias:w?.insurer_alias??w?.insurerAlias??e?.insurerAlias??e?.insurer_alias??bill?.insurer_alias??bill?.insurerAlias??"",
            kuitansi_number:bill?.kuitansi_number??bill?.kuitansiNumber??w?.kuitansi_number??w?.kuitansiNumber??"",
            grand_total:pNum(bill?.grand_total??bill?.grandTotal??w?.grand_total),
            paid_at:pay.paid_at||pay.paidAt||bill?.paid_at||"",
            payment_description:pay.description||pay.keterangan||bill?.payment_description||"",
            payment_id:pay.id||null
        });
    });
    return rows;
}

function renderPayments(){
    const body=pEl("paymentTableBody"); if(!body)return;
    const q=String(pEl("searchPayment")?.value||"").trim().toLowerCase();
    const rows=paymentRows.filter(r=>[r.kuitansi_number,r.wo_number,r.claim_number,r.customer_name,r.customer_code,r.plate_number,r.insurer_alias,r.insurer_name,r.payment_description].join(" ").toLowerCase().includes(q));
    if(!rows.length){body.innerHTML='<tr><td colspan="11" class="payment-empty">Belum ada WO yang sudah dibuat Tagihan Kuitansi.</td></tr>';return;}
    body.innerHTML=rows.map((r,i)=>{
        const paid=Boolean(r.paid_at);
        return `<tr><td>${i+1}</td><td>${pEsc(r.kuitansi_number||"-")}</td><td><strong>${pEsc(r.wo_number||"-")}</strong></td><td>${pEsc(r.claim_number||"-")}</td><td>${pEsc(r.customer_name||"-")}</td><td>${pEsc(r.plate_number||"-")}</td><td>${pEsc(r.insurer_alias||r.insurerAlias||"-")}</td><td><strong>${pEsc(pRupiah(r.grand_total))}</strong></td><td><span class="payment-status ${paid?"payment-paid":"payment-unpaid"}">${paid?"SUDAH BAYAR":"BELUM BAYAR"}</span></td><td>${pEsc(pDate(r.paid_at))}</td><td title="${pEsc(r.payment_description||"")}">${pEsc(r.payment_description||"-")}</td><td><div class="payment-actions"><button type="button" class="btn-primary btn-small" onclick="openPaymentModal('${pEsc(r.wo_id)}')">${paid?"Edit Pembayaran":"Input Pembayaran"}</button></div></td></tr>`;
    }).join("");
}

async function loadPayments(){
    try{
        const r=await api("/api/pembayaran");
        paymentRows=Array.isArray(r.data)?r.data:[];
    }catch(e){
        console.error("Gagal mengambil pembayaran dari database pusat:",e);
        paymentRows=[];
    }
    renderPayments();
}

function openPaymentModal(woId){
    const row=paymentRows.find(r=>String(r.wo_id)===String(woId));
    if(!row)return myWorkshopAlert("WO tidak ditemukan.");
    currentPayment=row;
    pEl("payKuitansi").textContent=row.kuitansi_number||"-";
    pEl("payWO").textContent=row.wo_number||"-";
    pEl("payClaim").textContent=pClaim(row)||"-";
    pEl("payCustomer").textContent=row.customer_name||"-";
    pEl("payInsurerAlias").textContent=row.insurer_alias||row.insurerAlias||"-";
    pEl("payAmount").textContent=pRupiah(row.grand_total);
    pEl("paidAt").value=(row.paid_at||"").slice(0,10)||pToday();
    pEl("paymentDescription").value=row.payment_description||"";
    pEl("paymentModal").classList.add("show");
    setTimeout(()=>pEl("paidAt")?.focus(),50);
}
function closePaymentModal(){pEl("paymentModal")?.classList.remove("show");currentPayment=null}

async function submitPayment(e){
    e.preventDefault();
    if(!currentPayment)return;
    const paidAt=String(pEl("paidAt")?.value||"").trim();
    const description=String(pEl("paymentDescription")?.value||"").trim();
    if(!paidAt){myWorkshopAlert("Tanggal Bayar wajib diisi.");return;}
    const payload={wo_id:Number(currentPayment.wo_id),paid_at:paidAt,description};
    try{
        await api("/api/pembayaran",{method:"POST",body:JSON.stringify(payload)});
        closePaymentModal();
        await loadPayments();
        showPaymentSuccessModal("Pembayaran berhasil disimpan.");
    }catch(err){
        myWorkshopAlert("Gagal menyimpan pembayaran ke database pusat.\n\n"+err.message);
    }
}

function showPaymentSuccessModal(message){
    const old=document.getElementById("paymentSuccessModal");
    if(old)old.remove();
    const modal=document.createElement("div");
    modal.id="paymentSuccessModal";
    modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;";
    const safe=String(message).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    modal.innerHTML=`<div style="background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);width:min(420px,calc(100% - 32px));padding:30px;text-align:center;"><div style="width:68px;height:68px;border-radius:50%;background:#22c55e;margin:0 auto 15px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(34,197,94,.28);animation:mwPaymentSuccessPop .35s ease-out;"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h3 style="margin:0 0 8px;color:#15803d;font-size:20px;">Berhasil</h3><div style="color:#334155;line-height:1.5;">${safe}</div></div>`;
    if(!document.getElementById("mwPaymentSuccessStyle")){const style=document.createElement("style");style.id="mwPaymentSuccessStyle";style.textContent="@keyframes mwPaymentSuccessPop{0%{transform:scale(.55);opacity:.2}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}";document.head.appendChild(style)}
    document.body.appendChild(modal);
    setTimeout(()=>modal.remove(),1500);
}

document.addEventListener("DOMContentLoaded",()=>{
    if(pEl("currentDate"))pEl("currentDate").textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    pEl("searchPayment")?.addEventListener("input",renderPayments);
    pEl("paymentForm")?.addEventListener("submit",submitPayment);
    pEl("paymentModal")?.addEventListener("click",e=>{if(e.target===pEl("paymentModal"))closePaymentModal()});
    loadPayments();
});
window.openPaymentModal=openPaymentModal;
window.closePaymentModal=closePaymentModal;
