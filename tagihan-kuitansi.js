
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
let kuitansiData=[];
let currentKuitansi=null;
let paymentBankAccounts=[];
const LOCAL_BILL_KEY=myWorkshopScopedStorageKey("myworkshop_tagihan_kuitansi");
const LOCAL_WO_KEY=myWorkshopScopedStorageKey("myworkshop_wo");
const LOCAL_EST_KEY=myWorkshopScopedStorageKey("myworkshop_estimasi");
const LOCAL_OR_KEY=myWorkshopScopedStorageKey("myworkshop_or_payments");
function el(id){return document.getElementById(id)}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function apiRequest(url,options={}){return fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options}).then(async r=>{let d={};try{d=await r.json()}catch(_){}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d})}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function rupiah(v){return "Rp "+num(v).toLocaleString("id-ID",{maximumFractionDigits:2})}
function dateOnly(v){if(!v)return "-";const d=v instanceof Date?new Date(v.getTime()):new Date(String(v).replace(" ","T"));if(Number.isNaN(d.getTime()))return "-";const dd=String(d.getDate()).padStart(2,"0"),mm=String(d.getMonth()+1).padStart(2,"0"),yyyy=d.getFullYear();return `${dd}/${mm}/${yyyy}`}
function userId(){try{const u=JSON.parse(localStorage.getItem("myworkshop_user")||"null");return num(u?.id||u?.user_id||u?.userId)||null}catch(_){return null}}
function localJSON(key,fallback=[]){try{const x=JSON.parse(localStorage.getItem(key)||"null");return Array.isArray(x)?x:fallback}catch(_){return fallback}}
function getId(x){return String(x?.id??x?.wo_id??x?.estimate_id??x?.estimateId??"")}
function getEstimateId(wo){return String(wo?.estimate_id??wo?.estimasiId??wo?.estimateId??"")}
function getEstId(est){return String(est?.id??est?.estimate_id??est?.estimasiId??"")}
function getEstimateNumber(est){return String(est?.estimate_number??est?.estimateNumber??est?.number??est?.noEstimasi??"")}
function getOwnRisk(est){return Math.max(0,num(est?.ownRisk??est?.own_risk??est?.or??est?.OR))}
function getMaterialPercent(est){const x=est?.materialPercent??est?.material_percent;return Math.max(0,Math.min(100,num(x)))}
function isUmumPribadi(d){
    const name=String(d?.insurer_name??d?.insurerName??d?.insurer??"").replace(/\s+/g," ").trim().toUpperCase();
    return name.includes("UMUM") || name.includes("PRIBADI");
}
function applyUmumPribadiRule(d){
    const special=isUmumPribadi(d);
    const mappings=[
        ["totalJasaPerbaikan", d?.total_jasa??d?.totalJasa??0],
        ["jasaLainAmount", d?.total_jasa_lain??d?.totalJasaLain??0]
    ];
    mappings.forEach(([id,value])=>{
        const input=el(id); if(!input)return;
        input.readOnly=special;
        input.title=special?"Nilai otomatis diambil dari TOTAL Estimasi.":"";
        if(special) input.value=num(value);
    });
    const sparepartInput=el("sparepartAmount");
    if(sparepartInput){
        sparepartInput.readOnly=true;
        sparepartInput.title="Nilai sparepart BENGKEL otomatis diambil dari Estimasi.";
        // UMUM / PRIBADI harus mengikuti total sparepart pada Estimasi;
        // jenis asuransi lain tetap memakai total sparepart BENGKEL.
        sparepartInput.value=num(special
            ? (d?.total_sparepart ?? d?.totalSparepart ?? 0)
            : (d?.bengkel_sparepart_total ?? 0));
    }
    return special;
}
function getLocalWOForKuitansi(woId){
    const rows=localJSON(LOCAL_WO_KEY,[]);
    return rows.find(w=>String(w?.id??w?.wo_id??"")===String(woId))||null;
}
function getBengkelPartsForKuitansi(d){
    const localWO=getLocalWOForKuitansi(d?.wo_id);
    const parts=localWO?.spareparts||localWO?.sparepart||localWO?.items_sparepart||d?.spareparts||[];
    if(!Array.isArray(parts))return [];
    return parts.filter(item=>String(item?.supply_bengkel??item?.supplyBengkel??item?.supply??"").trim().toUpperCase()==="BENGKEL");
}
function getLocalPOForKuitansi(woId){
    const rows=localJSON(myWorkshopScopedStorageKey("myworkshop_purchase_orders"),[]);
    return rows.find(po=>String(po?.wo_id)===String(woId))||null;
}
function applySparepartPOTrigger(d){
    const input=el("sparepartAmount"); const warning=el("sparepartWarning");
    const submit=el("kuitansiForm")?.querySelector('button[type="submit"]');
    const status=d?.bengkel_po_status||{};
    const blocked=!!status.required&&!status.ready;
    if(input){input.disabled=false;input.classList.remove("sparepart-locked");input.title="";}
    if(warning){
        warning.innerHTML=blocked
            ? `<div class="sparepart-po-warning">⚠ Tagihan Kuitansi terkunci. Purchase Order sparepart BENGKEL wajib dibuat terlebih dahulu${Array.isArray(status.missing)&&status.missing.length?` untuk: ${esc(status.missing.join(", "))}`:""}.</div>`
            : "";
    }
    if(submit){
        submit.disabled=blocked;
        submit.title=blocked?"Buat Purchase Order sparepart BENGKEL terlebih dahulu.":"";
    }
}

function localSaved(){return localJSON(LOCAL_BILL_KEY,[])}
function saveLocalSaved(rows){localStorage.setItem(LOCAL_BILL_KEY,JSON.stringify(rows))}
function localORPaid(woId){return localJSON(LOCAL_OR_KEY,[]).filter(p=>String(p?.wo_id)===String(woId)).reduce((s,p)=>s+Math.max(0,num(p?.amount)),0)}
function normalizeLocalRow(wo,est,saved){const own=getOwnRisk(est);const paid=localORPaid(wo?.id??wo?.wo_id);const savedRow=saved||{};return {...wo,...est,...savedRow,wo_id:String(wo?.id??wo?.wo_id??""),estimate_id:getEstimateId(wo)||getEstId(est),wo_number:wo?.wo_number??wo?.noWO??savedRow.wo_number??"",estimate_number:(getEstimateNumber(est)||wo?.estimate_number||wo?.noEstimasi||savedRow.estimate_number||""),customer_code:wo?.customer_code??wo?.customerCode??est?.customerCode??savedRow.customer_code??"",customer_name:wo?.customer_name??wo?.customerName??est?.customerName??savedRow.customer_name??"",customer_phone:wo?.customer_phone??wo?.phone??est?.customerPhone??"",insurer_id:wo?.insurer_id??est?.insurer_id??est?.insurerId??savedRow.insurer_id??"",insurer_name:wo?.insurer_name??wo?.insurerName??est?.insurerName??est?.insurer??savedRow.insurer_name??"",insurer_alias:wo?.insurer_alias??wo?.insurerAlias??est?.insurerAlias??est?.insurer_alias??savedRow.insurer_alias??savedRow.insurerAlias??"",insurer_address:wo?.insurer_address??est?.insurer_address??est?.insurerAddress??savedRow.insurer_address??"",insurer_code:wo?.insurer_code??est?.insurerCode??savedRow.insurer_code??"",claim_number:wo?.claim_number??wo?.claimNumber??est?.claim_number??est?.claimNumber??savedRow.claim_number??savedRow.claimNumber??"",polis_number:wo?.polis_number??est?.polis_number??est?.polisNumber??savedRow.polis_number??savedRow.polisNumber??"",plate_number:wo?.plate_number??wo?.plate??est?.plate??est?.plate_number??savedRow.plate_number??"",brand:wo?.brand??est?.brand??savedRow.brand??"",model:wo?.model??est?.model??savedRow.model??"",year:wo?.year??est?.year??savedRow.year??"",estimate_date:est?.estimate_date??est?.estimateDate??savedRow.estimate_date??"",check_in_at:wo?.check_in_at??wo?.checkInAt??savedRow.check_in_at??"",check_out_at:wo?.check_out_at??wo?.checkOutAt??savedRow.check_out_at??"",own_risk:own||num(savedRow.own_risk),or_paid:paid,or_remaining:Math.max(0,own-paid),or_status:own<=0?"TIDAK ADA OR":(paid>0?"LUNAS":"BELUM LUNAS"),kuitansi_status:savedRow.id||savedRow.kuitansi_id?"SUDAH DIBUAT":"BELUM DIBUAT",kuitansi_payment_id:savedRow.kuitansi_payment_id??savedRow.payment_id??null,kuitansi_id:savedRow.kuitansi_id??savedRow.id??null,_local:true}}
function buildLocalData(){const wos=localJSON(LOCAL_WO_KEY,[]);const ests=localJSON(LOCAL_EST_KEY,[]);const bills=localSaved();const emap=new Map(ests.map(e=>[getEstId(e),e]));return wos.filter(w=>{const st=String(w?.status??"").toUpperCase();if(st==="SELESAI"||st==="CHECK OUT")return true;const history=w?.process_history??w?.processHistory??[];return Array.isArray(history)&&history.some(h=>String(h?.status??"").toUpperCase()==="CHECK OUT");}).map(w=>normalizeLocalRow(w,emap.get(getEstimateId(w))||{},bills.find(b=>String(b?.wo_id)===String(w?.id??w?.wo_id))));}
function syncKuitansiTableHeader(){
    const table=el("kuitansiTableBody")?.closest("table");
    if(!table)return;
    const th=table.querySelectorAll("thead th");
    if(th.length>=10){
        th[0].textContent="No";
        th[1].textContent="No. Kuitansi";
        th[2].textContent="No. WO";
        th[3].textContent="No. Klaim";
        th[4].textContent="Customer";
    }
}
function render(){const body=el("kuitansiTableBody");if(!body)return;syncKuitansiTableHeader();const q=String(el("searchKuitansi")?.value||"").trim().toLowerCase();const rows=kuitansiData.filter(r=>[r.wo_number,r.kuitansi_number,r.claim_number,r.customer_name,r.customer_code,r.plate_number,(r.insurer_alias || r.insurerAlias || r.alias || r.insurer_name)].join(" ").toLowerCase().includes(q));if(!rows.length){body.innerHTML='<tr><td colspan="10" class="kuitansi-empty">Belum ada WO yang sudah CHECK OUT.</td></tr>';return}body.innerHTML=rows.map((r,i)=>{const billClass=r.kuitansi_id?"kuitansi-made":"kuitansi-belum";const payable=r.payable_amount??r.payableAmount??r.grand_total??r.grandTotal??0;const billStatus=r.kuitansi_id?`SUDAH DIBUAT - ${rupiah(payable)}`:"BELUM DIBUAT";const poStatus=r.bengkel_po_status||{};const poBlocked=!r.kuitansi_id&&!!poStatus.required&&!poStatus.ready;const poWarning=poBlocked?`<div class="sparepart-warning" style="display:block!important;margin-top:6px;padding:5px 7px;border:1px solid #dc2626;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:11px;line-height:1.3">⚠ PO BENGKEL belum dibuat${Array.isArray(poStatus.missing)&&poStatus.missing.length?`: ${esc(poStatus.missing.join(", "))}`:""}</div>`:"";const action=r.kuitansi_id?`<button type="button" class="btn-kuitansi btn-small" onclick="openKuitansiModal('${esc(r.wo_id)}')">Edit Kuitansi</button>`:(poBlocked?`<button type="button" class="btn-kuitansi btn-small" disabled title="Purchase Order sparepart BENGKEL wajib dibuat terlebih dahulu.">Buat Kuitansi</button>`:`<button type="button" class="btn-kuitansi btn-small" onclick="openKuitansiModal('${esc(r.wo_id)}')">Buat Kuitansi</button>`);const alias=String(r.insurer_alias??r.insurerAlias??r.alias??"").trim()||"-";return `<tr><td>${i+1}</td><td>${esc(r.kuitansi_number || (r.kuitansi_id?"KWT-"+String(r.kuitansi_id).padStart(6,"0"):"-"))}</td><td><strong>${esc(r.wo_number)}</strong></td><td>${esc(r.claim_number||"-")}</td><td>${esc(r.customer_name)}</td><td>${esc(r.plate_number)}</td><td>${esc(alias)}</td><td><strong>${esc(rupiah(r.own_risk))}</strong></td><td><span class="kuitansi-status ${billClass}">${esc(billStatus)}</span>${poBlocked?`<div class="sparepart-warning" style="display:block!important;margin-top:4px;padding:4px 6px;border:1px solid #dc2626;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:10px">⚠ PO BENGKEL BELUM DIBUAT</div>`:""}</td><td><div class="kuitansi-actions">${action}${r.kuitansi_id?`<button type="button" class="btn-secondary btn-small" onclick="printKuitansi('${esc(r.wo_id)}')">Print</button>`:""}</div>${poWarning}</td></tr>`}).join("")}

function setVal(id,v){if(el(id))el(id).value=v}

// ==========================================================
// TAGIHAN KUITANSI - MODAL & PERHITUNGAN
// ==========================================================
function closeKuitansiModal(){
    const modal=el("kuitansiModal");
    if(modal) modal.classList.remove("show");
    currentKuitansi=null;
}

function calculate(){
    const specialUmumPribadi=isUmumPribadi(currentKuitansi);
    const totalJasaPerbaikan=Math.max(0,num(specialUmumPribadi?(currentKuitansi?.total_jasa??currentKuitansi?.totalJasa??0):el("totalJasaPerbaikan")?.value));
    const materialPercent=Math.max(0,Math.min(100,num(String(el("materialPercent")?.value||"").replace("%",""))));
    const labourPercent=100-materialPercent;
    const materialAmount=totalJasaPerbaikan*materialPercent/100;
    const labourAmount=totalJasaPerbaikan*labourPercent/100;
    const sparepartAmount=Math.max(0,num(specialUmumPribadi
        ? (currentKuitansi?.total_sparepart ?? currentKuitansi?.totalSparepart ?? 0)
        : el("sparepartAmount")?.value));
    const jasaLainAmount=Math.max(0,num(specialUmumPribadi?(currentKuitansi?.total_jasa_lain??currentKuitansi?.totalJasaLain??0):el("jasaLainAmount")?.value));
    const ppnPercentRaw=num(el("ppnPercent")?.value);
    const ppnPercent=[0,10,11].includes(ppnPercentRaw)?ppnPercentRaw:0;
    const ppnType=String(el("ppnType")?.value||"SPAREPART_JASA").toUpperCase();

    // Dasar PPN sesuai aturan cetak Kuitansi:
    // SPAREPART_JASA = item 1 + 2 + 3
    // COMPLETE       = item 1 + 2 + 3 + 4
    const totalBase=sparepartAmount+materialAmount+labourAmount+jasaLainAmount;
    let ppnBase=0;
    if(ppnType==="SPAREPART_JASA") ppnBase=sparepartAmount+materialAmount+labourAmount;
    else if(ppnType==="COMPLETE") ppnBase=totalBase;

    const ppnAmount=ppnBase*ppnPercent/100;
    // Total paling atas selalu item 1 + 2 + 3 + 4, lalu ditambah PPN.
    const totalBeforeDeductions=totalBase+ppnAmount;
    const pphAmount=labourAmount*2/100;
    const ownRisk=Math.max(0,num(currentKuitansi?.own_risk));
    const salvageAmount=Math.max(0,num(el("salvageAmount")?.value));
    const systemFee=Math.max(0,num(el("systemFee")?.value));
    const grandTotal=Math.max(0,totalBeforeDeductions-ownRisk-salvageAmount-pphAmount-systemFee);

    setVal("materialAmount",rupiah(materialAmount));
    setVal("labourAmount",rupiah(labourAmount));
    setVal("ppnBase",rupiah(ppnBase));
    setVal("ppnAmount",rupiah(ppnAmount));
    setVal("totalBefore",rupiah(totalBeforeDeductions));
    setVal("orAmount",rupiah(ownRisk));
    const orCalcRow = el("orAmount")?.closest(".calc-row");
    if (orCalcRow) orCalcRow.style.display = ownRisk > 0 ? "" : "none";
    setVal("salvageDisplay",rupiah(salvageAmount));
    setVal("pphAmount",rupiah(pphAmount));
    setVal("systemDisplay",rupiah(systemFee));
    setVal("grandTotal",rupiah(grandTotal));
    setVal("payableAmount",rupiah(grandTotal));

    return {
        total_jasa_perbaikan:totalJasaPerbaikan,
        material_percent:materialPercent,
        labour_percent:labourPercent,
        material_amount:materialAmount,
        labour_amount:labourAmount,
        sparepart_amount:sparepartAmount,
        jasa_lain_amount:jasaLainAmount,
        ppn_percent:ppnPercent,
        ppn_type:ppnType,
        ppn_base:ppnBase,
        ppn_amount:ppnAmount,
        pph_percent:2,
        pph_amount:pphAmount,
        own_risk:ownRisk,
        salvage_amount:salvageAmount,
        system_fee:systemFee,
        total_before_deductions:totalBeforeDeductions,
        grand_total:grandTotal,
        payable_percent:100
    };
}
function renderBankAccountOptions(selectedId){const select=el("bankAccountSelect");if(!select)return;select.innerHTML='<option value="">Pilih rekening pembayaran</option>'+paymentBankAccounts.map(a=>`<option value="${esc(a.id)}">${esc([a.bank,a.account_number,a.account_name].filter(Boolean).join(" - "))}</option>`).join("");if(selectedId)select.value=String(selectedId);}
async function loadPaymentBankAccounts(){try{const r=await apiRequest("/api/settings/payment-bank-accounts");paymentBankAccounts=Array.isArray(r?.data?.kuitansi_accounts)?r.data.kuitansi_accounts:[];}catch(e){console.error("Gagal mengambil rekening pembayaran:",e);paymentBankAccounts=[];}}
function selectedBankAccount(){const id=String(el("bankAccountSelect")?.value||"");return paymentBankAccounts.find(a=>String(a.id)===id)||null;}
function loadFormData(d){currentKuitansi=d;el("modalTitle").textContent=d.kuitansi_id?`Edit Tagihan Kuitansi — ${d.wo_number}`:`Buat Tagihan Kuitansi — ${d.wo_number}`;el("fWo").textContent=d.wo_number||"-";el("fEstimate").textContent=d.estimate_number||"-";el("fCustomer").textContent=d.customer_name||"-";el("fVehicle").textContent=[d.plate_number,d.brand,d.model].filter(Boolean).join(" / ")||"-";const ownRisk=Math.max(0,num(d.own_risk));el("fOR").textContent=rupiah(ownRisk);const orCard=el("fORCard");if(orCard)orCard.style.display=ownRisk>0?"":"none";const warning=el("orWarning");if(warning)warning.innerHTML="";const mp=getMaterialPercent(d);setVal("materialPercent",mp+"%");setVal("labourPercent",(100-mp)+"%");setVal("totalJasaPerbaikan",d.total_jasa_perbaikan??"");setVal("sparepartAmount",d.sparepart_amount??0);setVal("jasaLainAmount",d.jasa_lain_amount??0);applyUmumPribadiRule(d);setVal("ppnPercent",d.ppn_percent??11);setVal("ppnType",d.ppn_type||"SPAREPART_JASA");setVal("salvageAmount",d.salvage_amount??0);setVal("systemFee",d.system_fee??0);renderBankAccountOptions(d.bank_account_id);if(!d.bank_account_id&&paymentBankAccounts.length===1)el("bankAccountSelect").value=String(paymentBankAccounts[0].id);applySparepartPOTrigger(d);calculate()}
async function openKuitansiModal(woId){try{const r=await apiRequest(`/api/tagihan-kuitansi/${encodeURIComponent(woId)}`);let d=r.data;if(!d)throw new Error("WO CHECK OUT tidak ditemukan.");if(!d.insurer_address&&d.insurer_id){try{const ar=await apiRequest(`/api/asuransi/${encodeURIComponent(d.insurer_id)}`);if(ar?.data)d.insurer_address=ar.data.address||"";}catch(_){}}loadFormData(d);el("kuitansiModal").classList.add("show")}catch(e){myWorkshopAlert("Gagal membuka Tagihan Kuitansi.\n\n"+e.message)}}

function terbilang(n){n=Math.floor(Math.max(0,num(n)));if(n===0)return"NOL";const a=["","SATU","DUA","TIGA","EMPAT","LIMA","ENAM","TUJUH","DELAPAN","SEMBILAN","SEPULUH","SEBELAS"];function f(x){if(x<12)return a[x];if(x<20)return f(x-10)+" BELAS";if(x<100)return f(Math.floor(x/10))+" PULUH"+(x%10?" "+f(x%10):"");if(x<200)return"SERATUS"+(x%100?" "+f(x%100):"");if(x<1000)return f(Math.floor(x/100))+" RATUS"+(x%100?" "+f(x%100):"");if(x<2000)return"SERIBU"+(x%1000?" "+f(x%1000):"");if(x<1000000)return f(Math.floor(x/1000))+" RIBU"+(x%1000?" "+f(x%1000):"");if(x<1000000000)return f(Math.floor(x/1000000))+" JUTA"+(x%1000000?" "+f(x%1000000):"");if(x<1000000000000)return f(Math.floor(x/1000000000))+" MILIAR"+(x%1000000000?" "+f(x%1000000000):"");return f(Math.floor(x/1000000000000))+" TRILIUN"+(x%1000000000000?" "+f(x%1000000000000):"")}return f(n)+" RUPIAH"}
function buildLocalDetail(woId){return buildLocalData().find(x=>String(x.wo_id)===String(woId))||null}
async function getPrintData(woId){
    try {
        const r = await apiRequest(`/api/tagihan-kuitansi/${encodeURIComponent(woId)}`);
        const data = r?.data;
        if (!data) return null;
        const kuitansiId = data.kuitansi_id ?? data.id ?? null;
        if (kuitansiId === null || kuitansiId === undefined || kuitansiId === "") return null;
        return { ...data, kuitansi_id: kuitansiId };
    } catch (error) {
        console.error("GET DETAIL KUITANSI UNTUK PRINT ERROR:", error);
        return null;
    }
}

async function printKuitansi(woId){try{let d=await getPrintData(woId);if(!d)return myWorkshopAlert("Tagihan Kuitansi belum disimpan.");const historyPrint=await apiRequest(`/api/document-history/TAGIHAN_KUITANSI/${encodeURIComponent(d.kuitansi_id)}/print`,{method:"POST"});const printCount=Math.max(1,Number(historyPrint?.print_count||1));const printWatermark=printCount>=2?`<div class="print-watermark">PRINT ${printCount}${printCount%100>=11&&printCount%100<=13?"th":printCount%10===1?"st":printCount%10===2?"nd":printCount%10===3?"rd":"th"}</div>`:"";if(!d.insurer_address&&d.insurer_id){try{const ar=await apiRequest(`/api/asuransi/${encodeURIComponent(d.insurer_id)}`);if(ar?.data)d.insurer_address=ar.data.address||"";}catch(_){}}const noKwitansi=d.kuitansi_number|| (d.kuitansi_id?.startsWith?.("LOCAL-KWT-")?d.kuitansi_id.replace("LOCAL-KWT-","KWT-"):"KWT-"+new Date().getFullYear()+"-"+String(d.kuitansi_id).padStart(6,"0"));const ppnLabel=d.ppn_type==="NONE"?`VAT (PPN) -`:d.ppn_type==="SPAREPART_JASA"?`VAT (PPN) Atas Sparepart dan Jasa ${num(d.ppn_percent).toFixed(2)}%`:`VAT (PPN) Atas Lengkap ${num(d.ppn_percent).toFixed(2)}%`;const printSparepart=num(d.sparepart_amount);const printMaterial=num(d.material_amount);const printLabour=num(d.labour_amount);const printJasaLain=num(d.jasa_lain_amount);const printPpnType=String(d.ppn_type||"SPAREPART_JASA").toUpperCase();const printTotalBase=printSparepart+printMaterial+printLabour+printJasaLain;const printPpnBase=printPpnType==="NONE"?0:(printPpnType==="COMPLETE"?printTotalBase:(printSparepart+printMaterial+printLabour));const printPpnAmount=printPpnBase*num(d.ppn_percent)/100;const total=printTotalBase+printPpnAmount;const lessTotal=Math.max(0,total-num(d.own_risk)-num(d.salvage_amount)-num(d.pph_amount));const grand=Math.max(0,lessTotal-num(d.system_fee));const workshopHeader=await getWorkshopPrintHeader();const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>MyWorkshop</title><style>@page{size:A4;margin:11mm 13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10px;margin:0;position:relative}.sheet{width:100%;max-width:190mm;margin:auto;position:relative}.print-watermark{position:fixed;z-index:0;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);font-size:28px;font-weight:700;letter-spacing:2px;color:rgba(100,100,100,.16);white-space:nowrap;pointer-events:none}.sheet>*{position:relative;z-index:1}.top{display:grid;grid-template-columns:1fr 1fr;gap:10px}.company{font-weight:700;line-height:1.35}.address{font-weight:400;white-space:pre-line}.letterhead{text-align:left;border-bottom:2px solid #111;padding-bottom:7px;margin-bottom:10px}.kop-line{display:none}.letterhead .name{font-size:16px;font-weight:700;line-height:1.25}.letterhead .sub{font-size:9px;line-height:1.4;color:#333}.title{text-align:center;font-size:14px;font-weight:700;color:#666;letter-spacing:.4px;margin-bottom:8px}.right{text-align:left;font-size:9px;line-height:1.5}.right b{display:inline-block;width:118px}.meta{border:1px solid #9ca3af;margin-top:9px;padding:5px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.meta-row{display:grid;grid-template-columns:105px 1fr;padding:2px 0}.meta-row b{font-weight:700}.items{width:100%;border-collapse:collapse;margin-top:5px}.items th,.items td{border:1px solid #9ca3af;padding:4px 5px}.items th{font-weight:700;text-align:left}.items td.amount{text-align:right;white-space:nowrap}.items td.no{width:25px;text-align:center}.summary{width:100%;border-collapse:collapse;margin-top:5px}.summary td{padding:2px 5px}.summary .label{text-align:right;width:78%}.summary .amt{text-align:right;width:22%;white-space:nowrap}.summary .strong td{font-weight:700}.summary .line td{border-top:1px solid #9ca3af;padding-top:4px}.words{margin-top:5px;font-weight:700;font-style:italic;text-transform:uppercase}.bank{margin-top:7px;font-size:9px;line-height:1.45}.note{margin-top:6px;font-size:9px}.sign{display:grid;grid-template-columns:1fr;text-align:left;margin-top:35px}.sign>div{width:260px}.sign .line{margin-top:55px}.footer{font-size:8px;color:#666;text-align:center;margin-top:12px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${printWatermark}<div class="sheet">${workshopHeader}<div class="title">KWITANSI PERBAIKAN</div><div class="top"><div class="company">${esc(d.insurer_name||"Asuransi")}<br><span class="address">${esc(d.insurer_address||"-")}</span></div><div class="right"><div><b>No. Kwitansi:</b>${esc(noKwitansi)}</div><div><b>No. Referensi Bengkel:</b>${esc(d.wo_number||"-")}</div><div><b>No. Referensi Asuransi:</b>${esc(d.estimate_claim_number||d.estimateClaimNumber||d.claim_number||d.claimNumber||"-")}</div><div><b>Tanggal:</b>${esc(dateOnly(new Date()))}</div></div></div><div class="meta"><div class="meta-grid"><div><div class="meta-row"><b>Nomor Polisi</b><span>${esc(d.plate_number||"-")}</span></div><div class="meta-row"><b>Tertanggung</b><span>${esc(d.customer_name||"-")}</span></div><div class="meta-row"><b>Model Kendaraan</b><span>${esc([d.brand,d.model].filter(Boolean).join(" ")||"-")}</span></div><div class="meta-row"><b>Tanggal Masuk</b><span>${esc(dateOnly(d.check_in_at))}</span></div></div><div><div class="meta-row"><b>No. Polis</b><span>${esc(d.estimate_polis_number||d.estimatePolisNumber||d.polis_number||d.polisNumber||"-")}</span></div><div class="meta-row"><b>Check-out Date</b><span>${esc(dateOnly(d.check_out_at))}</span></div></div></div></div><table class="items"><thead><tr><th>No</th><th>Deskripsi</th><th style="text-align:right">Jumlah</th></tr></thead><tbody><tr><td class="no">1</td><td>Parts</td><td class="amount">${esc(rupiah(d.sparepart_amount))}</td></tr><tr><td class="no">2</td><td>Labour (Material)</td><td class="amount">${esc(rupiah(d.material_amount))}</td></tr><tr><td class="no">3</td><td>Labour (Jasa)</td><td class="amount">${esc(rupiah(d.labour_amount))}</td></tr><tr><td class="no">4</td><td>Miscellaneous Items</td><td class="amount">${esc(rupiah(d.jasa_lain_amount))}</td></tr></tbody></table><table class="summary"><tr><td class="label">Total</td><td class="amt">${esc(rupiah(printTotalBase))}</td></tr><tr><td class="label">${esc(ppnLabel)}</td><td class="amt">${esc(rupiah(printPpnAmount))}</td></tr><tr class="strong line"><td class="label">Total</td><td class="amt">${esc(rupiah(total))}</td></tr>${num(d.own_risk)>0?`<tr><td class="label">Less Risiko Sendiri</td><td class="amt">${esc(rupiah(d.own_risk))}</td></tr>`:""}<tr><td class="label">Less Salvage</td><td class="amt">${esc(rupiah(d.salvage_amount))}</td></tr><tr><td class="label">Less PPH 2.00% (on labour)</td><td class="amt">${esc(rupiah(d.pph_amount))}</td></tr><tr class="strong line"><td class="label">Total</td><td class="amt">${esc(rupiah(lessTotal))}</td></tr><tr><td class="label">Less Biaya Proporsional Sistem</td><td class="amt">${esc(rupiah(d.system_fee))}</td></tr><tr class="strong line"><td class="label">Grand Total</td><td class="amt">${esc(rupiah(grand))}</td></tr><tr><td class="label">Payable Amount (100.00%)</td><td class="amt">${esc(rupiah(grand))}</td></tr></table><div class="words">(${esc(terbilang(grand))})</div><div class="bank"><b>Please bank-in payment to our bank account:</b><br>Bank: ${esc(d.bank_name||"_______________________________")}<br>Account No: ${esc(d.bank_account_number||"________________________") }<br>Account Name: ${esc(d.bank_account_name||"____________________") }<br>Payment Ref: ${esc(d.estimate_claim_number||d.estimateClaimNumber||d.claim_number||d.claimNumber||d.estimate_number||"-")}</div><div class="note"><b>Note:</b> TOTAL KWITANSI BENGKEL Rp ${esc(num(grand).toLocaleString("id-ID"))}</div><div class="sign"><div>Authorized Signatory / Stamp<div class="line">________________________</div></div></div><div class="footer"></div></div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>`;const w=window.open("","_blank","width=900,height=850");if(!w)return myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak kuitansi.");w.document.write(html);w.document.close()}catch(e){myWorkshopAlert("Gagal mencetak Kuitansi.\n\n"+e.message)}}
async function load(){try{await loadPaymentBankAccounts();const r=await apiRequest("/api/tagihan-kuitansi");kuitansiData=Array.isArray(r.data)?r.data:[];const pending=kuitansiData.filter(row=>!row.kuitansi_id);if(pending.length){const work=await apiRequest("/api/sparepart/work-data");const workRows=Array.isArray(work?.data)?work.data:[];const purchaseOrders=Array.isArray(work?.purchase_orders)?work.purchase_orders:[];const statusMap=new Map();workRows.forEach(wo=>{const parts=Array.isArray(wo?.spareparts)?wo.spareparts:[];const bengkelParts=parts.filter(item=>String(item?.supply_bengkel??item?.supplyBengkel??item?.supply??"BENGKEL").trim().toUpperCase()!=="SUPPLY");if(!bengkelParts.length)return;const po=purchaseOrders.find(x=>String(x?.wo_id??x?.woId??"")===String(wo?.id??wo?.wo_id??""));statusMap.set(String(wo?.id??wo?.wo_id??""),{required:true,ready:!!po,total:bengkelParts.length,missing:po?[]:bengkelParts.map(x=>x?.part_name||"-")})});kuitansiData=kuitansiData.map(row=>statusMap.has(String(row.wo_id))?{...row,bengkel_po_status:statusMap.get(String(row.wo_id))}:row)}}catch(e){console.error("Gagal mengambil Tagihan Kuitansi dari database pusat:",e);kuitansiData=[];const body=el("kuitansiTableBody");if(body)body.innerHTML=`<tr><td colspan="10" class="kuitansi-empty">Gagal memuat data Tagihan Kuitansi: ${esc(e.message)}</td></tr>`;return}render()}

document.addEventListener("DOMContentLoaded",()=>{if(el("currentDate"))el("currentDate").textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});el("searchKuitansi")?.addEventListener("input",render);el("kuitansiForm")?.addEventListener("submit",submitKuitansi);["totalJasaPerbaikan","sparepartAmount","jasaLainAmount","ppnPercent","ppnType","salvageAmount","systemFee"].forEach(id=>el(id)?.addEventListener("input",calculate));["ppnPercent","ppnType"].forEach(id=>el(id)?.addEventListener("change",calculate));el("kuitansiModal")?.addEventListener("click",e=>{if(e.target===el("kuitansiModal"))closeKuitansiModal()});syncKuitansiTableHeader();load()});
window.openKuitansiModal=openKuitansiModal;window.closeKuitansiModal=closeKuitansiModal;window.printKuitansi=printKuitansi;async function submitKuitansi(e){e.preventDefault();if(!currentKuitansi)return;const values=calculate();try{const r=await apiRequest("/api/tagihan-kuitansi",{method:"POST",body:JSON.stringify({wo_id:currentKuitansi.wo_id,...values,claim_number:currentKuitansi.claim_number||currentKuitansi.claimNumber||"",polis_number:currentKuitansi.polis_number||currentKuitansi.polisNumber||"",bank_account:selectedBankAccount(),created_by:userId()})});await myWorkshopAlert(r.message||"Tagihan Kuitansi berhasil disimpan.", "success");closeKuitansiModal();await load()}catch(err){myWorkshopAlert("Gagal menyimpan Tagihan Kuitansi ke database pusat.\n\n"+err.message)}}

