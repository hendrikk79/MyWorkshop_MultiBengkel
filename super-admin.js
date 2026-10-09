(async()=>{
const rows=document.getElementById("rows"),form=document.getElementById("form"),notice=document.getElementById("notice"),search=document.getElementById("workshopSearch");
let workshops=[];
const esc=v=>{const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML};
function msg(t){notice.textContent=t;notice.style.cssText="padding:10px;margin-bottom:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px"}
function readLogo(file, square=false){
    return new Promise((resolve,reject)=>{
        if(!file){resolve(null);return}
        if(file.size>1024*1024){reject(new Error("Ukuran logo maksimal 1 MB."));return}
        if(!["image/png","image/jpeg","image/webp"].includes(file.type)){reject(new Error("Logo harus PNG, JPG/JPEG atau WebP."));return}
        const reader=new FileReader();
        reader.onload=()=>{
            const src=String(reader.result||"");
            if(!square){resolve(src);return}
            const img=new Image();
            img.onload=()=>{
                try{
                    const side=Math.min(img.naturalWidth,img.naturalHeight);
                    const sx=(img.naturalWidth-side)/2;
                    const sy=(img.naturalHeight-side)/2;
                    const canvas=document.createElement("canvas");
                    const target=800;
                    canvas.width=target; canvas.height=target;
                    const ctx=canvas.getContext("2d");
                    ctx.clearRect(0,0,target,target);
                    ctx.drawImage(img,sx,sy,side,side,0,0,target,target);
                    resolve(canvas.toDataURL("image/png"));
                }catch(err){ reject(new Error("Logo 1:1 gagal diproses.")); }
            };
            img.onerror=()=>reject(new Error("Logo gagal diperiksa."));
            img.src=src;
        };
        reader.onerror=()=>reject(new Error("Logo gagal dibaca."));
        reader.readAsDataURL(file);
    });
}
function openWorkshopEdit(id){
    const target=`/super-admin-workshop-edit.html?id=${encodeURIComponent(Number(id))}`;
    window.location.assign(target);
}

function modal(w){
    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px";
    overlay.innerHTML=`<div style="background:#fff;width:min(560px,100%);max-height:90vh;overflow:auto;border-radius:12px;padding:20px;box-sizing:border-box"><h2 style="margin-top:0">Edit Bengkel</h2><form id="editWorkshopForm" style="display:grid;gap:12px"><input name="name" placeholder="Nama Bengkel" required value="${esc(w.name)}"><input name="document_code" placeholder="Kode Identitas Dokumen (unik)" maxlength="20" required value="${esc(w.document_code||w.workshop_code||"")}"><input name="phone" placeholder="Telepon" value="${esc(w.phone||"")}"><input name="email" type="email" placeholder="Email" value="${esc(w.email||"")}"><input name="address" placeholder="Alamat" value="${esc(w.address||"")}"><input name="notes" placeholder="Catatan" value="${esc(w.notes||"")}"><label style="display:flex;flex-direction:column;gap:6px;font-weight:600">Logo Free Size<input name="logo_file" type="file" accept="image/png,image/jpeg,image/webp">${w.logo_data?`<img src="${esc(w.logo_data)}" style="width:120px;height:80px;object-fit:contain;border:1px solid #ddd;border-radius:8px;padding:4px">`:""}</label><label style="display:flex;flex-direction:column;gap:6px;font-weight:600">Logo 1:1 (untuk Dashboard)<input name="logo_square_file" type="file" accept="image/png,image/jpeg,image/webp">${w.logo_data_square?`<img src="${esc(w.logo_data_square)}" style="width:80px;height:80px;object-fit:contain;border:1px solid #ddd;border-radius:8px;padding:4px">`:""}</label><label style="display:flex;align-items:center;gap:8px"><input name="is_active" type="checkbox" ${Number(w.is_active)?"checked":""}> Bengkel Aktif</label><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="cancelEdit">Batal</button><button type="submit">Simpan</button></div></form></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#cancelEdit").onclick=()=>overlay.remove();
    overlay.querySelector("#editWorkshopForm").onsubmit=async e=>{
        e.preventDefault();
        try{
            const f=e.currentTarget, file=f.elements.logo_file.files[0], squareFile=f.elements.logo_square_file.files[0];
            const data={name:f.elements.name.value,document_code:f.elements.document_code.value,phone:f.elements.phone.value,email:f.elements.email.value,address:f.elements.address.value,notes:f.elements.notes.value,is_active:f.elements.is_active.checked?1:0};
            if(file) data.logo_data=await readLogo(file,false);
            else if(w.logo_data) data.logo_data=w.logo_data;
            else data.logo_data=null;
            if(squareFile) data.logo_data_square=await readLogo(squareFile,true);
            else if(w.logo_data_square) data.logo_data_square=w.logo_data_square;
            else data.logo_data_square=null;
            const r=await fetch(`/api/super-admin/workshops/${Number(w.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
            const j=await r.json(); if(!r.ok||!j.success)throw Error(j.message||"Gagal memperbarui bengkel");
            overlay.remove(); msg("Data bengkel berhasil diperbarui."); await load();
        }catch(err){msg(err.message)}
    };
}
function renderWorkshops(){
    const q=(search?.value||"").trim().toLowerCase();
    const filtered=workshops.filter(w=>[w.workshop_code,w.name,w.phone,w.email,w.address].some(v=>String(v||"").toLowerCase().includes(q)));
    rows.innerHTML=filtered.map(w=>`<tr><td>${esc(w.workshop_code)}</td><td>${esc(w.document_code||w.workshop_code||"-")}</td><td>${w.logo_data_square?`<img src="${esc(w.logo_data_square)}" alt="Logo 1:1" style="width:46px;height:46px;object-fit:contain;border:1px solid #ddd;border-radius:6px">`:(w.logo_data?`<img src="${esc(w.logo_data)}" alt="Logo" style="width:46px;height:46px;object-fit:contain;border:1px solid #ddd;border-radius:6px">`:`-`)}</td><td>${esc(w.name)}</td><td>${esc(w.phone||"-")}</td><td>${Number(w.is_active)?"AKTIF":"NONAKTIF"}</td><td style="display:flex;gap:6px;flex-wrap:wrap"><button class="sa-action-btn" data-edit="${w.id}">Edit</button><button class="sa-action-btn" data-id="${w.id}">Masuk sebagai Bengkel</button></td></tr>`).join("")||'<tr><td colspan="7">Bengkel tidak ditemukan.</td></tr>';
    rows.querySelectorAll("button[data-edit]").forEach(b=>b.onclick=()=>{
        const id=Number(b.dataset.edit);
        if(Number.isFinite(id)&&id>0) openWorkshopEdit(id);
    });
    rows.querySelectorAll("button[data-id]").forEach(b=>b.onclick=async()=>{const r=await fetch("/api/super-admin/impersonate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workshop_id:Number(b.dataset.id)})});const j=await r.json();if(!r.ok||!j.success)return msg(j.message||"Gagal");j.user.acting_as=true;j.user.actor_user_id=JSON.parse(localStorage.getItem("myworkshop_user")||"null")?.id||null;localStorage.setItem("myworkshop_user",JSON.stringify(j.user));location.href="/dashboard.html"})
}
async function load(){
    const r=await fetch("/api/super-admin/workshops");const j=await r.json();if(!r.ok||!j.success)throw Error(j.message||"Gagal");
    workshops=j.data||[]; renderWorkshops();
}
if(search) search.addEventListener("input",renderWorkshops);
form.onsubmit=async e=>{
    e.preventDefault();
    try{
        const data=Object.fromEntries(new FormData(form));
        const file=form.elements.logo_file?.files?.[0];
        const squareFile=form.elements.logo_square_file?.files?.[0];
        data.logo_data=await readLogo(file,false);
        data.logo_data_square=await readLogo(squareFile,true);
        delete data.logo_file;
        const r=await fetch("/api/super-admin/workshops",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||!j.success)throw Error(j.message||"Gagal membuat bengkel");form.reset();msg("Bengkel berhasil dibuat.");await load();
    }catch(err){msg(err.message)}
};
try{await load()}catch(e){msg(e.message)}
})();
