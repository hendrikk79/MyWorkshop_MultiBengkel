
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
// MYWORKSHOP - ESTIMASI
// ==========================================================
// CUSTOMER
// - Customer dipilih dari data Customer.
// - Pencarian berdasarkan nama / kode / nomor telepon.
//
// KENDARAAN
// - No. Polisi
// - Merk Mobil
// - Type Mobil
// - Tahun Mobil
// - Warna
// - No. Rangka
// - No. Mesin
//
// ASURANSI
// - Asuransi
// - No. Klaim Asuransi
// - No. Polis Asuransi
// - Agent
//
// DETAIL
// - Sparepart
// - Jasa Pengecatan / Perbaikan
// - Jasa Lain-lain
//
// PERHITUNGAN
// - Material : Labour tetap masuk perhitungan.
// - Material : Labour dihitung berdasarkan TOTAL JASA
//   Pengecatan / Perbaikan.
// - PPH = 2% x Nilai Labour.
// ==========================================================


// ==========================================================
// GLOBAL
// ==========================================================

let estimasiData = [];

let editingEstimasiId = null;
let editingEstimasiOriginal = null;

let selectedCustomer = null;

let estimasiCustomers = [];

let estimasiCustomersLoaded = false;

let estimasiCustomersLoading = false;

let estimasiMobilMasukData = [];


// ==========================================================
// MASTER DATA ASURANSI
// ==========================================================

let estimasiAsuransiData = [];


// ==========================================================
// LOAD ASURANSI AKTIF
// ==========================================================

async function loadAsuransiForEstimasi() {

    const select =
        document.getElementById(
            "estimasiInsurer"
        );

    if (!select) {

        console.error(
            "Element #estimasiInsurer tidak ditemukan."
        );

        return;

    }


    try {

        select.innerHTML = `
            <option value="">
                Memuat Asuransi...
            </option>
        `;


        const response =
            await fetch(
                "/api/asuransi/aktif",
                {
                    method: "GET",

                    headers: {
                        "Accept":
                            "application/json"
                    },

                    cache: "no-store"
                }
            );


        const text =
            await response.text();


        let result;


        try {

            result =
                JSON.parse(text);

        } catch (error) {

            console.error(
                "RESPON API ASURANSI BUKAN JSON:",
                text
            );

            throw new Error(
                "API Asuransi tidak mengembalikan JSON."
            );

        }


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Gagal mengambil Master Data Asuransi."
            );

        }


        if (
            Array.isArray(result)
        ) {

            estimasiAsuransiData =
                result;

        } else if (
            Array.isArray(result.data)
        ) {

            estimasiAsuransiData =
                result.data;

        } else {

            estimasiAsuransiData =
                [];

        }


        select.innerHTML = `
            <option value="">
                -- Pilih Asuransi --
            </option>
        `;


        estimasiAsuransiData.forEach(
            function (item) {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    item.id;

                option.textContent =
                    item.name ||
                    item.nama ||
                    "";

                select.appendChild(
                    option
                );

            }
        );


        console.log(
            "DATA ASURANSI ESTIMASI:",
            estimasiAsuransiData
        );


    } catch (error) {

        console.error(
            "LOAD ASURANSI ESTIMASI ERROR:",
            error
        );


        select.innerHTML = `
            <option value="">
                -- Gagal memuat Asuransi --
            </option>
        `;

    }

}


// ==========================================================
// TERAPKAN PAKEM MATERIAL : LABOUR DARI ASURANSI
// ==========================================================

function applyInsurerMaterialSplit() {

    const select =
        document.getElementById("estimasiInsurer");

    const materialElement =
        document.getElementById("materialPercent");

    const labourElement =
        document.getElementById("labourPercent");

    if (!select || !materialElement) {
        return;
    }

    const insurerId = Number(select.value);

    if (!insurerId) {
        return;
    }

    const insurer =
        estimasiAsuransiData.find(
            item => Number(item.id) === insurerId
        );

    if (!insurer) {
        return;
    }

    let materialPercent =
        Number(
            insurer.material_percent ??
            insurer.materialPercent ??
            0
        );

    if (!Number.isFinite(materialPercent)) {
        materialPercent = 0;
    }

    materialPercent =
        Math.max(0, Math.min(100, materialPercent));

    materialElement.value = materialPercent;

    if (labourElement) {
        labourElement.value = 100 - materialPercent;
    }

    calculateEstimasi();
}


// ==========================================================
// LOGIN
// ==========================================================

const estimasiUserData =
    localStorage.getItem(
        "myworkshop_user"
    );


if (!estimasiUserData) {

    window.location.href = "/";

}


let currentUser = null;


try {

    currentUser =
        JSON.parse(
            estimasiUserData
        );

} catch (error) {

    currentUser = null;

}


// ==========================================================
// USER PEMBUAT
// ==========================================================

function isCurrentManagerMaster() {
    const role = currentUser?.role?.code ?? currentUser?.role?.name ?? currentUser?.role_code ?? currentUser?.role_name ?? currentUser?.role;
    return String(role || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") === "MANAGER MASTER";
}

function titleCaseEstimasiUser(value) {
    const text = String(value ?? "").trim();
    if (!text || text === "-") return "-";
    return text.split(/\s+/).map(word =>
        word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""
    ).join(" ");
}

function getCurrentEstimasiUserName() {
    return titleCaseEstimasiUser(
        currentUser?.name ?? currentUser?.full_name ?? currentUser?.fullName ?? currentUser?.nama
        ?? currentUser?.nama_user ?? currentUser?.username ?? currentUser?.user_name ?? "-"
    );
}

function getEstimasiCreatedBy(item) {
    const saved = item?.created_by_name ?? item?.createdByName ?? item?.creator_name ?? item?.creatorName
        ?? item?.created_by ?? item?.createdBy ?? item?.user_id ?? item?.userId;
    if (saved === null || saved === undefined || saved === "") return getCurrentEstimasiUserName();

    const currentId = currentUser?.id ?? currentUser?.user_id ?? currentUser?.userId;
    if (currentId !== undefined && String(saved) === String(currentId)) return getCurrentEstimasiUserName();

    return titleCaseEstimasiUser(saved);
}

// ==========================================================
// ELEMENT
// ==========================================================

const estimasiModal =
    document.getElementById(
        "estimasiModal"
    );


const estimasiForm =
    document.getElementById(
        "estimasiForm"
    );


const estimasiTableBody =
    document.getElementById(
        "estimasiTableBody"
    );


const searchEstimasi =
    document.getElementById(
        "searchEstimasi"
    );


const customerSearch =
    document.getElementById(
        "customerSearch"
    );


const customerResults =
    document.getElementById(
        "customerResults"
    );


const customerSelected =
    document.getElementById(
        "customerSelected"
    );


const estimasiCustomer =
    document.getElementById(
        "estimasiCustomer"
    );


const sparepartBody =
    document.getElementById(
        "sparepartBody"
    );


const jasaBody =
    document.getElementById(
        "jasaBody"
    );


const jasaLainBody =
    document.getElementById(
        "jasaLainBody"
    );


// ==========================================================
// STORAGE
// ==========================================================

function normalizeEstimasiFromApi(item) {
    if (!item || typeof item !== "object") return item;

    // API menggunakan snake_case, sedangkan halaman Estimasi memakai
    // properti camelCase. Normalisasi di satu tempat agar daftar tidak
    // kosong/terlihat tidak lengkap setelah data tersimpan di database.
    return {
        ...item,
        id: item.id,
        number: item.number ?? item.estimate_number ?? item.estimateNumber ?? "",
        date: item.date ?? item.estimate_date ?? item.estimateDate ?? "",
        customerId: item.customerId ?? item.customer_id ?? null,
        customerCode: item.customerCode ?? item.customer_code ?? "",
        customerName: item.customerName ?? item.customer_name ?? "",
        customerPhone: item.customerPhone ?? item.customer_phone ?? "",
        customerType: item.customerType ?? item.customer_type ?? "",
        customerAddress: item.customerAddress ?? item.customer_address ?? "",
        customerNotes: item.customerNotes ?? item.customer_notes ?? "",
        vehicleId: item.vehicleId ?? item.vehicle_id ?? null,
        insurerId: item.insurerId ?? item.insurer_id ?? null,
        insurerName: item.insurerName ?? item.insurer_name ?? item.insurer ?? "",
        insurerAlias: item.insurerAlias ?? item.insurer_alias ?? "",
        insurer: item.insurer ?? item.insurerName ?? item.insurer_name ?? "",
        claimNumber: item.claimNumber ?? item.claim_number ?? "",
        polisNumber: item.polisNumber ?? item.polis_number ?? "",
        agent: item.agent ?? "",
        notes: item.notes ?? item.customer_note ?? "",
        plateNumber: item.plateNumber ?? item.plate_number ?? "",
        brand: item.brand ?? "",
        model: item.model ?? "",
        year: item.year ?? "",
        color: item.color ?? "",
        vin: item.vin ?? item.vin_number ?? "",
        vinNumber: item.vinNumber ?? item.vin_number ?? "",
        engineNumber: item.engineNumber ?? item.engine_number ?? "",
        customerNote: item.customerNote ?? item.customer_note ?? "",
        notes: item.notes ?? item.customer_note ?? "",
        discount: item.discount ?? 0,
        discountSparepartType: item.discountSparepartType ?? item.discount_sparepart_type ?? "PERCENT",
        discountSparepartValue: item.discountSparepartValue ?? item.discount_sparepart_value ?? 0,
        discountJasaType: item.discountJasaType ?? item.discount_jasa_type ?? "PERCENT",
        discountJasaValue: item.discountJasaValue ?? item.discount_jasa_value ?? 0,
        discountSparepart: item.discountSparepart ?? item.discount_sparepart ?? 0,
        discountJasa: item.discountJasa ?? item.discount_jasa ?? 0,
        afterDiscount: item.afterDiscount ?? item.total_after_discount ?? 0,
        subtotal: item.subtotal ?? 0,
        sparepartTotal: item.sparepartTotal ?? item.total_sparepart ?? 0,
        jasaTotal: item.jasaTotal ?? item.total_jasa ?? 0,
        jasaLainTotal: item.jasaLainTotal ?? item.total_jasa_lain ?? 0,
        ppnPercent: item.ppnPercent ?? item.ppn_percent ?? 0,
        ppnType: item.ppnType ?? item.ppn_type ?? "COMPLETE",
        ppn: item.ppn ?? item.ppn_amount ?? 0,
        materialPercent: item.materialPercent ?? item.material_percent ?? 0,
        labourPercent: item.labourPercent ?? item.labour_percent ?? (100 - Number(item.material_percent || 0)),
        labourValue: item.labourValue ?? item.labour_amount ?? 0,
        pph: item.pph ?? item.pph_amount ?? 0,
        ownRisk: item.ownRisk ?? item.own_risk ?? 0,
        grandTotal: item.grandTotal ?? item.grand_total ?? 0,
        billed: item.billed ?? item.total_billed ?? 0,
        createdBy: item.createdBy ?? item.created_by ?? null,
        created_at: item.created_at ?? item.createdAt ?? "",
        updated_at: item.updated_at ?? item.updatedAt ?? "",
        // Status WO berasal dari database agar tetap benar setelah refresh/browser berbeda.
        hasWo: Boolean(Number(item.has_wo ?? item.hasWo ?? 0)),
        has_wo: Boolean(Number(item.has_wo ?? item.hasWo ?? 0)),
        spareparts: Array.isArray(item.spareparts) ? item.spareparts.map(sp => ({
            ...sp, name: sp.name ?? sp.part_name ?? "", sku: sp.sku ?? sp.part_number ?? "",
            qty: sp.qty ?? sp.quantity ?? 0, price: sp.price ?? sp.unit_price ?? 0,
            discount: sp.discount ?? sp.discount_amount ?? 0,
            discountPercent: sp.discountPercent ?? sp.discount_percent ?? null,
            total: sp.total ?? sp.total_price ?? 0,
            // Pilihan BENGKEL/SUPPLY berasal dari database dan harus ikut
            // terbawa saat Estimasi dibuka lalu direvisi.
            supply_bengkel: String(sp.supply_bengkel ?? sp.supplyBengkel ?? sp.supply ?? "BENGKEL").toUpperCase() === "SUPPLY" ? "SUPPLY" : "BENGKEL"
        })) : [],
        jasa: Array.isArray(item.jasa) ? item.jasa.map(js => ({
            ...js, panel: js.panel ?? js.panel_name ?? "", jenis: js.jenis ?? js.service_type ?? "",
            qty: js.qty ?? js.quantity ?? 1, amount: js.amount ?? js.unit_price ?? 0,
            discount: js.discount ?? js.discount_amount ?? 0,
            discountPercent: js.discountPercent ?? js.discount_percent ?? null,
            total: js.total ?? js.total_price ?? 0
        })) : [],
        jasaLain: Array.isArray(item.jasaLain ?? item.jasa_lain) ? (item.jasaLain ?? item.jasa_lain).map(js => ({
            ...js, name: js.name ?? js.service_name ?? "", qty: js.qty ?? js.quantity ?? 1,
            amount: js.amount ?? js.unit_price ?? js.total_price ?? 0
        })) : []
    };
}

async function loadMobilMasukForEstimasi() {
    try {
        const response = await fetch("/api/mobil-masuk", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
        estimasiMobilMasukData = Array.isArray(result.data) ? result.data : [];

        const datalist = document.getElementById("mobilMasukOptions");
        if (datalist) {
            datalist.innerHTML = estimasiMobilMasukData.map(item => {
                const plate = String(item.plate_number || "").trim();
                const label = [item.brand, item.model, item.color].filter(Boolean).join(" - ");
                return `<option value="${escapeHtml(plate)}">${escapeHtml(label)}</option>`;
            }).join("");
        }
    } catch (error) {
        console.warn("Gagal mengambil data Mobil Masuk untuk Estimasi:", error);
        estimasiMobilMasukData = [];
    }
}

function applyMobilMasukToEstimasi() {
    if (editingEstimasiId) return;
    const plateInput = document.getElementById("estimasiPlate");
    const sourceInput = document.getElementById("estimasiMobilMasukId");
    if (!plateInput) return;

    const plate = String(plateInput.value || "").trim().toUpperCase();
    const found = estimasiMobilMasukData.find(item =>
        String(item.plate_number || "").trim().toUpperCase() === plate
    );

    if (!found) {
        if (sourceInput) sourceInput.value = "";
        return;
    }

    if (sourceInput) sourceInput.value = String(found.id);
    setValue("estimasiBrand", found.brand || "");
    setValue("estimasiModel", found.model || "");
    setValue("estimasiColor", found.color || "");
}

async function loadEstimasi() {
    try {
        const response = await fetch("/api/estimasi", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
        estimasiData = Array.isArray(result.data)
            ? result.data.map(normalizeEstimasiFromApi)
            : [];
    } catch (error) {
        console.error("Gagal mengambil Estimasi dari database pusat:", error);
        estimasiData = [];
    }
}

function saveEstimasiStorage() {
    // Estimasi adalah data transaksi dan tidak lagi disimpan di localStorage.
}

// ==========================================================
// CUSTOMER
// ==========================================================

async function loadCustomersForEstimasi() {

    if (
        estimasiCustomersLoaded
    ) {

        return estimasiCustomers;

    }


    if (
        estimasiCustomersLoading
    ) {

        return estimasiCustomers;

    }


    estimasiCustomersLoading =
        true;


    try {

        const response =
            await fetch(
                "/api/customers"
            );


        if (!response.ok) {

            throw new Error(
                "Gagal mengambil data Customer."
            );

        }


        const result =
            await response.json();


        if (!result.success) {

            throw new Error(
                result.message ||
                "Gagal mengambil data Customer."
            );

        }


        estimasiCustomers =
            Array.isArray(
                result.data
            )
                ? result.data
                : [];


        estimasiCustomersLoaded =
            true;


    } catch (error) {

        console.error(
            "Gagal mengambil Customer:",
            error
        );


        estimasiCustomers =
            [];

    } finally {

        estimasiCustomersLoading =
            false;

    }


    return estimasiCustomers;

}


function getCustomers() {

    return estimasiCustomers;

}


// ==========================================================
// CUSTOMER HELPER
// ==========================================================

function customerCode(
    customer
) {

    return String(

        customer?.customer_code ||

        customer?.code ||

        customer?.customerCode ||

        customer?.id ||

        ""

    );

}


function customerName(
    customer
) {

    return String(

        customer?.name ||

        customer?.customerName ||

        customer?.nama ||

        ""

    );

}


// ==========================================================
// CUSTOMER SEARCH
// ==========================================================

async function showCustomerResults(
    keyword = ""
) {

    const customers =
        await loadCustomersForEstimasi();


    const q =
        String(keyword)
            .trim()
            .toLowerCase();


    const filtered =
        customers.filter(
            customer => {

                const name =
                    customerName(
                        customer
                    ).toLowerCase();


                const code =
                    customerCode(
                        customer
                    ).toLowerCase();


                const phone =
                    String(
                        customer?.phone ||
                        customer?.no_telepon ||
                        customer?.telephone ||
                        ""
                    ).toLowerCase();


                return (

                    !q ||

                    name.includes(q) ||

                    code.includes(q) ||

                    phone.includes(q)

                );

            }
        );


    customerResults.innerHTML =
        "";


    if (
        !filtered.length
    ) {

        customerResults.innerHTML = `

            <div class="customer-result">

                Customer tidak ditemukan.

            </div>

        `;


        customerResults.classList.add(
            "show"
        );


        return;

    }


    filtered.forEach(
        customer => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "customer-result";


            const name =
                customerName(
                    customer
                );


            item.innerHTML = `

                <strong>
                    ${escapeHtml(name)}
                </strong>

                <small>
                    ${escapeHtml(
                        customerCode(customer)
                    )}
                </small>

            `;


            item.addEventListener(
                "click",
                function () {

                    selectCustomer(
                        customer
                    );

                }
            );


            customerResults.appendChild(
                item
            );

        }
    );


    customerResults.classList.add(
        "show"
    );

}


// ==========================================================
// SELECT CUSTOMER
// ==========================================================

function selectCustomer(
    customer
) {

    selectedCustomer =
        customer;


    const code =
        customerCode(
            customer
        );


    const name =
        customerName(
            customer
        );


    estimasiCustomer.value =
        code;


    customerSearch.value =
        name;


    customerSelected.innerHTML = `

        <strong>
            ${escapeHtml(name)}
        </strong>

    `;


    customerSelected.style.display =
        "block";


    customerResults.classList.remove(
        "show"
    );

}


// ==========================================================
// ESCAPE HTML
// ==========================================================

function escapeHtml(value) {

    return String(
        value ?? ""
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


// ==========================================================
// NUMBER
// ==========================================================

function numberValue(
    value
) {

    const number =
        Number(value);


    return Number.isFinite(
        number
    )
        ? number
        : 0;

}


// ==========================================================
// RUPIAH
// ==========================================================

function formatRupiah(
    value
) {

    return new Intl.NumberFormat(
        "id-ID",
        {

            style: "currency",

            currency: "IDR",

            maximumFractionDigits: 0

        }
    ).format(
        numberValue(value)
    );

}


// ==========================================================
// NOMOR ESTIMASI
// ==========================================================

function generateEstimasiNumber() {

    const year =
        new Date().getFullYear();


    let maxNumber = 0;


    estimasiData.forEach(
        item => {

            const match =
                String(
                    item.number || ""
                ).match(
                    /(\d+)$/
                );


            if (match) {

                maxNumber =
                    Math.max(
                        maxNumber,
                        Number(
                            match[1]
                        )
                    );

            }

        }
    );


    const next =
        maxNumber + 1;


    return (

        "EST-" +

        year +

        "-" +

        String(next)
            .padStart(
                4,
                "0"
            )

    );

}


// ==========================================================
// DATE
// ==========================================================

// Tanggal baru = DD/MM/YYYY
function todayDate() {

    const date =
        new Date();


    const day =
        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        );


    const month =
        String(
            date.getMonth() + 1
        ).padStart(
            2,
            "0"
        );


    const year =
        date.getFullYear();


    return (
        `${day}/${month}/${year}`
    );

}


// ==========================================================
// FORMAT DATE
// ==========================================================
//
// Mendukung:
//
// DD/MM/YYYY
// YYYY-MM-DD
// ISO Date
//
// ==========================================================

function formatDate(
    value
) {

    if (!value) {

        return "-";

    }


    const text =
        String(value).trim();


    // Sudah DD/MM/YYYY
    if (
        /^\d{2}\/\d{2}\/\d{4}$/.test(
            text
        )
    ) {

        return text;

    }


    // YYYY-MM-DD
    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            text
        )
    ) {

        const parts =
            text.split("-");


        return (
            `${parts[2]}/${parts[1]}/${parts[0]}`
        );

    }


    // ISO Date
    const date =
        new Date(text);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return text;

    }


    return date.toLocaleDateString(
        "id-ID",
        {

            day: "2-digit",

            month: "2-digit",

            year: "numeric"

        }
    );

}


// ==========================================================
// SET VALUE
// ==========================================================

function setValue(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.value =
            value ?? "";

    }

}


// ==========================================================
// MODAL - OPEN
// ==========================================================

async function openEstimasiForm(
    id = null
) {

    editingEstimasiId =
        id || null;


    clearMessage();


    estimasiForm.reset();
    setValue("estimasiMobilMasukId", "");


    sparepartBody.innerHTML =
        "";


    jasaBody.innerHTML =
        "";


    jasaLainBody.innerHTML =
        "";


    selectedCustomer =
        null;


    estimasiCustomer.value =
        "";


    customerSearch.value =
        "";


    customerSelected.style.display =
        "none";


    customerSelected.innerHTML =
        "";


    customerResults.classList.remove(
        "show"
    );


    // ======================================================
    // DEFAULT FORM
    // ======================================================

    setValue(
        "estimasiDate",
        todayDate()
    );



    setValue(
        "ppnPercent",
        0
    );


    setValue(
        "ppnType",
        "COMPLETE"
    );


    setValue(
        "materialPercent",
        0
    );


    setValue(
        "labourPercent",
        100
    );


    setValue(
        "ownRisk",
        0
    );


    // ======================================================
    // EDIT
    // ======================================================

    if (id !== null) {

        const data =
            estimasiData.find(
                item =>
                    String(item.id) ===
                    String(id)
            );


        if (!data) {

            myWorkshopAlert(
                "Data estimasi tidak ditemukan."
            );

            return;

        }


        let detailData = data;
        try {
            const response = await fetch(`/api/estimasi/${encodeURIComponent(id)}`, { cache: "no-store" });
            const result = await response.json();
            if (response.ok && result?.success && result?.data) {
                detailData = normalizeEstimasiFromApi(result.data);
                const index = estimasiData.findIndex(x => String(x.id) === String(id));
                if (index >= 0) estimasiData[index] = detailData;
            }
        } catch (e) {
            console.warn("Gagal mengambil detail Estimasi untuk edit:", e);
        }

        editingEstimasiOriginal = cloneDocumentHistoryValue(detailData);

        fillEstimasiForm(
            detailData
        );


        document.getElementById(
            "estimasiModalTitle"
        ).textContent =
            "Edit Estimasi";


    } else {

        document.getElementById(
            "estimasiModalTitle"
        ).textContent =
            "Buat Estimasi";


        addSparepartRow();


        addJasaRow();


        addJasaLainRow();

    }


    calculateEstimasi();


    estimasiModal.classList.add(
        "show"
    );

}


window.openEstimasiForm =
    openEstimasiForm;


// ==========================================================
// MODAL - CLOSE
// ==========================================================

function closeEstimasiForm() {

    estimasiModal.classList.remove(
        "show"
    );


    editingEstimasiId =
        null;
    editingEstimasiOriginal = null;


    clearMessage();

}


window.closeEstimasiForm =
    closeEstimasiForm;


// ==========================================================
// FILL EDIT
// ==========================================================

function fillEstimasiForm(
    data
) {

    if (!data) {

        return;

    }


    // ======================================================
    // CUSTOMER
    // ======================================================

    setValue(
        "estimasiCustomer",
        data.customerId ||
        data.customer_id ||
        data.customerCode ||
        ""
    );


    setValue(
        "customerSearch",
        data.customerName ||
        data.customer ||
        ""
    );


    if (
        data.customerName ||
        data.customer
    ) {

        customerSelected.innerHTML = `

            <strong>
                ${escapeHtml(
                    data.customerName ||
                    data.customer
                )}
            </strong>

        `;


        customerSelected.style.display =
            "block";

    }


    // ======================================================
    // KENDARAAN
    // ======================================================

    setValue(
        "estimasiPlate",
        data.plateNumber ||
        data.plate ||
        data.noPolisi ||
        data.no_polisi ||
        ""
    );


    setValue(
        "estimasiBrand",
        data.brand ||
        data.carBrand ||
        data.merkMobil ||
        ""
    );


    setValue(
        "estimasiModel",
        data.model ||
        data.carModel ||
        data.carType ||
        data.typeMobil ||
        ""
    );


    setValue(
        "estimasiYear",
        data.year ||
        data.carYear ||
        data.tahunMobil ||
        ""
    );


    setValue(
        "estimasiColor",
        data.color ||
        data.warna ||
        ""
    );


    setValue(
        "estimasiVin",
        data.vin ||
        data.chassisNumber ||
        data.noRangka ||
        ""
    );


    setValue(
        "estimasiEngine",
        data.engineNumber ||
        data.engine ||
        data.noMesin ||
        ""
    );


    // ======================================================
    // ASURANSI
    // ======================================================

    setValue(
        "estimasiInsurer",
        data.insurer_id ||
        data.insurerId ||
        ""
    );


    setValue(
        "claimNumber",
        data.claimNumber ||
        ""
    );


    setValue(
        "PolisNumber",
        data.polisNumber ||
        ""
    );


    setValue(
        "Agent",
        data.agent ||
        ""
    );


    setValue(
        "estimasiNotes",
        data.notes ||
        ""
    );


    // ======================================================
    // TANGGAL
    // ======================================================

    setValue(
        "estimasiDate",
        data.date
            ? formatDate(data.date)
            : todayDate()
    );


    // ======================================================
    // PERHITUNGAN
    // ======================================================


    setValue(
        "ppnPercent",
        data.ppnPercent ?? 0
    );


    setValue(
        "ppnType",
        data.ppnType ||
        "COMPLETE"
    );


    setValue(
        "materialPercent",
        data.materialPercent ?? 0
    );


    setValue(
        "labourPercent",
        data.labourPercent ??
        (
            100 -
            numberValue(
                data.materialPercent
            )
        )
    );


    setValue(
        "ownRisk",
        data.ownRisk ?? 0
    );


    // ======================================================
    // SPAREPART
    // ======================================================

    const spareparts =
        Array.isArray(
            data.spareparts
        )
            ? data.spareparts
            : [];


    if (
        spareparts.length
    ) {

        spareparts.forEach(
            row => {

                addSparepartRow(
                    row
                );

            }
        );

    } else {

        addSparepartRow();

    }


    // ======================================================
    // JASA
    // ======================================================

    const jasa =
        Array.isArray(
            data.jasa
        )
            ? data.jasa
            : [];


    if (
        jasa.length
    ) {

        jasa.forEach(
            row => {

                addJasaRow(
                    row
                );

            }
        );

    } else {

        addJasaRow();

    }


    // ======================================================
    // JASA LAIN
    // ======================================================

    const jasaLain =
        Array.isArray(
            data.jasaLain
        )
            ? data.jasaLain
            : [];


    if (
        jasaLain.length
    ) {

        jasaLain.forEach(
            row => {

                addJasaLainRow(
                    row
                );

            }
        );

    } else {

        addJasaLainRow();

    }

}


// ==========================================================
// SPAREPART
// ==========================================================

function addSparepartRow(
    data = {}
) {

    const tr =
        document.createElement(
            "tr"
        );

    tr.dataset.supplyBengkel =
        String(data.supply_bengkel ?? data.supplyBengkel ?? data.supply ?? "BENGKEL").trim().toUpperCase() === "SUPPLY"
            ? "SUPPLY"
            : "BENGKEL";


    const qty =
        numberValue(
            data.qty ?? data.quantity ?? 1
        ) || 1;


    const price =
        numberValue(
            data.price ?? data.unit_price ?? 0
        );

    // Pertahankan sumber sparepart yang sudah tersimpan di database.
    const supplyBengkel =
        String(data.supply_bengkel ?? data.supplyBengkel ?? data.supply ?? "BENGKEL").trim().toUpperCase() === "SUPPLY"
            ? "SUPPLY"
            : "BENGKEL";


    const storedDiscount =
        numberValue(
            data.discount ??
            data.discount_amount ??
            0
        );


    const storedPercent =
        data.discountPercent ??
        data.discount_percent;


    const discountPercent =
        storedPercent !== null &&
        storedPercent !== undefined &&
        storedPercent !== ""
            ? Math.max(
                0,
                Math.min(
                    100,
                    numberValue(storedPercent)
                )
            )
            : (
                qty > 0 && price > 0
                    ? Math.max(
                        0,
                        Math.min(
                            100,
                            storedDiscount /
                            (qty * price) *
                            100
                        )
                    )
                    : 0
            );


    tr.innerHTML = `

        <td>

            <input
                type="text"
                class="sparepart-name"
                placeholder="Nama sparepart"
                value="${escapeHtml(
                    data.name || ""
                )}"
            >

        </td>


        <td>

            <input
                type="text"
                class="sparepart-sku"
                placeholder="No. Part / SKU"
                value="${escapeHtml(
                    data.sku || ""
                )}"
            >

        </td>


        <td>

            <input
                type="number"
                class="sparepart-qty"
                min="0"
                step="0.01"
                value="${qty}"
            >

        </td>


        <td>

            <input
                type="number"
                class="sparepart-price"
                min="0"
                step="0.01"
                value="${price}"
            >

        </td>


        <td>

            <input
                type="number"
                class="sparepart-discount-percent"
                min="0"
                max="100"
                step="0.01"
                value="${discountPercent}"
                inputmode="decimal"
            >

        </td>


        <td
            class="num currency sparepart-total"
        >
            Rp 0
        </td>


        <td>

            <button
                type="button"
                class="remove-btn"
                title="Hapus"
            >
                ×
            </button>

        </td>

    `;


    tr.querySelectorAll(
        "input"
    ).forEach(
        input => {

            input.addEventListener(
                "input",
                calculateEstimasi
            );

        }
    );


    tr.querySelector(
        ".remove-btn"
    ).addEventListener(
        "click",
        () => {

            tr.remove();

            calculateEstimasi();

        }
    );


    sparepartBody.appendChild(
        tr
    );


    calculateEstimasi();

}


window.addSparepartRow =
    addSparepartRow;


// ==========================================================
// JASA PENGECATAN / PERBAIKAN
// ==========================================================

function addJasaRow(
    data = {}
) {

    const tr =
        document.createElement(
            "tr"
        );


    const jenis =
        data.jenis || "";


    const price =
        numberValue(
            data.amount ??
            data.unit_price ??
            0
        );


    const storedDiscount =
        numberValue(
            data.discount ??
            data.discount_amount ??
            0
        );


    const storedPercent =
        data.discountPercent ??
        data.discount_percent;


    const discountPercent =
        storedPercent !== null &&
        storedPercent !== undefined &&
        storedPercent !== ""
            ? Math.max(
                0,
                Math.min(
                    100,
                    numberValue(storedPercent)
                )
            )
            : (
                price > 0
                    ? Math.max(
                        0,
                        Math.min(
                            100,
                            storedDiscount /
                            price *
                            100
                        )
                    )
                    : 0
            );


    tr.innerHTML = `

        <td>

            <input
                type="text"
                class="jasa-panel"
                placeholder="Nama panel"
                value="${escapeHtml(
                    data.panel || ""
                )}"
            >

        </td>


        <td>

            <select
                class="jasa-jenis"
            >

                <option value="">
                    Pilih jenis
                </option>

                <option
                    value="Penyok"
                    ${
                        jenis === "Penyok"
                            ? "selected"
                            : ""
                    }
                >
                    Penyok
                </option>

                <option
                    value="Baret"
                    ${
                        jenis === "Baret"
                            ? "selected"
                            : ""
                    }
                >
                    Baret
                </option>

                <option
                    value="Ganti"
                    ${
                        jenis === "Ganti"
                            ? "selected"
                            : ""
                    }
                >
                    Ganti
                </option>

                <option
                    value="Bongkar Pasang"
                    ${
                        jenis === "Bongkar Pasang"
                            ? "selected"
                            : ""
                    }
                >
                    Bongkar Pasang
                </option>

                <option
                    value="Special Repairs"
                    ${
                        jenis === "Special Repairs"
                            ? "selected"
                            : ""
                    }
                >
                    Special Repairs
                </option>

            </select>

        </td>


        <td>

            <input
                type="number"
                class="jasa-price"
                min="0"
                step="0.01"
                value="${price}"
            >

        </td>


        <td>

            <input
                type="number"
                class="jasa-discount-percent"
                min="0"
                max="100"
                step="0.01"
                value="${discountPercent}"
                inputmode="decimal"
            >

        </td>


        <td class="num currency jasa-total">
            Rp 0
        </td>


        <td>

            <button
                type="button"
                class="remove-btn"
                title="Hapus"
            >
                ×
            </button>

        </td>

    `;


    tr.querySelectorAll(
        "input, select"
    ).forEach(
        input => {

            input.addEventListener(
                "input",
                calculateEstimasi
            );


            input.addEventListener(
                "change",
                calculateEstimasi
            );

        }
    );


    tr.querySelector(
        ".remove-btn"
    ).addEventListener(
        "click",
        () => {

            tr.remove();

            calculateEstimasi();

        }
    );


    jasaBody.appendChild(
        tr
    );


    calculateEstimasi();

}


window.addJasaRow =
    addJasaRow;


// ==========================================================
// JASA LAIN-LAIN
// ==========================================================

function addJasaLainRow(
    data = {}
) {

    const tr =
        document.createElement(
            "tr"
        );


    tr.innerHTML = `

        <td>

            <input
                type="text"
                class="jasa-lain-name"
                placeholder="Nama jasa"
                value="${escapeHtml(
                    data.name || ""
                )}"
            >

        </td>


        <td>

            <input
                type="number"
                class="jasa-lain-price"
                min="0"
                step="0.01"
                value="${data.amount ?? 0}"
            >

        </td>


        <td>

            <button
                type="button"
                class="remove-btn"
                title="Hapus"
            >
                ×
            </button>

        </td>

    `;


    tr.querySelectorAll(
        "input"
    ).forEach(
        input => {

            input.addEventListener(
                "input",
                calculateEstimasi
            );

        }
    );


    tr.querySelector(
        ".remove-btn"
    ).addEventListener(
        "click",
        () => {

            tr.remove();

            calculateEstimasi();

        }
    );


    jasaLainBody.appendChild(
        tr
    );


    calculateEstimasi();

}


window.addJasaLainRow =
    addJasaLainRow;


// ==========================================================
// TOTAL SPAREPART
// ==========================================================

function getSparepartTotal() {

    let total = 0;


    sparepartBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                const qty =
                    numberValue(
                        row.querySelector(
                            ".sparepart-qty"
                        )?.value
                    );


                const price =
                    numberValue(
                        row.querySelector(
                            ".sparepart-price"
                        )?.value
                    );


                const discountPercent =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            numberValue(
                                row.querySelector(
                                    ".sparepart-discount-percent"
                                )?.value
                            )
                        )
                    );


                const bruto =
                    Math.max(
                        0,
                        qty * price
                    );


                const discount =
                    bruto *
                    discountPercent /
                    100;


                const amount =
                    Math.max(
                        0,
                        bruto - discount
                    );


                const totalCell =
                    row.querySelector(
                        ".sparepart-total"
                    );


                if (totalCell) {

                    totalCell.textContent =
                        formatRupiah(
                            amount
                        );

                }


                total +=
                    amount;

            }
        );


    return total;


}


// ==========================================================
// TOTAL JASA
// ==========================================================

function getJasaTotal() {

    let total = 0;


    jasaBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                const price =
                    numberValue(
                        row.querySelector(
                            ".jasa-price"
                        )?.value
                    );


                const discountPercent =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            numberValue(
                                row.querySelector(
                                    ".jasa-discount-percent"
                                )?.value
                            )
                        )
                    );


                const amount =
                    Math.max(
                        0,
                        price -
                        (
                            price *
                            discountPercent /
                            100
                        )
                    );


                const totalCell =
                    row.querySelector(
                        ".jasa-total"
                    );


                if (totalCell) {

                    totalCell.textContent =
                        formatRupiah(
                            amount
                        );

                }


                total +=
                    amount;

            }
        );


    return total;


}

// ==========================================================
// TOTAL JASA LAIN
// ==========================================================

function getJasaLainTotal() {

    let total = 0;


    jasaLainBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                total +=
                    numberValue(
                        row.querySelector(
                            ".jasa-lain-price"
                        )?.value
                    );

            }
        );


    return total;

}


// ==========================================================
// PERHITUNGAN
// ==========================================================

function calculateEstimasi() {

    const sparepart =
        getSparepartTotal();


    const jasa =
        getJasaTotal();


    const jasaLain =
        getJasaLainTotal();


    // ======================================================
    // SUBTOTAL
    // ======================================================

    const subtotal =
        sparepart +
        jasa +
        jasaLain;


    // ======================================================
    // DISKON PER BARIS
    // ======================================================
    // Nilai sparepart dan jasa sudah merupakan nilai setelah diskon per item.
    const discountSparepartType = "PERCENT";
    const discountSparepartValue = 0;
    const discountJasaType = "PERCENT";
    const discountJasaValue = 0;
    const discountSparepart = 0;
    const discountJasa = 0;


    let grossSparepartTotal = 0;


    sparepartBody
        .querySelectorAll("tr")
        .forEach(
            row => {
                grossSparepartTotal +=
                    numberValue(
                        row.querySelector(
                            ".sparepart-qty"
                        )?.value
                    ) *
                    numberValue(
                        row.querySelector(
                            ".sparepart-price"
                        )?.value
                    );
            }
        );


    let grossJasaTotal = 0;


    jasaBody
        .querySelectorAll("tr")
        .forEach(
            row => {
                grossJasaTotal +=
                    numberValue(
                        row.querySelector(
                            ".jasa-price"
                        )?.value
                    );
            }
        );


    const discount =
        Math.max(
            0,
            grossSparepartTotal - sparepart
        ) +
        Math.max(
            0,
            grossJasaTotal - jasa
        );


    const afterDiscount =
        Math.max(
            0,
            subtotal
        );

    // ======================================================
    // PPN
    // ======================================================

    const ppnPercent =
        numberValue(
            document.getElementById(
                "ppnPercent"
            )?.value
        );


    const ppnType =
        document.getElementById(
            "ppnType"
        )?.value ||
        "COMPLETE";


    let ppnBase = 0;


    if (
        ppnType ===
        "SPAREPART_JASA"
    ) {

        ppnBase =
            Math.max(
                0,
                sparepart +
                jasa
            );

    } else {

        ppnBase =
            afterDiscount;

    }


    const ppn =
        ppnBase *
        ppnPercent /
        100;


    // ======================================================
    // MATERIAL : LABOUR
    // ======================================================

    let materialPercent =
        numberValue(
            document.getElementById(
                "materialPercent"
            )?.value
        );


    materialPercent =
        Math.max(
            0,
            Math.min(
                100,
                materialPercent
            )
        );


    const labourPercent =
        100 -
        materialPercent;


    const materialValue =
        jasa *
        materialPercent /
        100;


    const labourValue =
        jasa *
        labourPercent /
        100;


    // ======================================================
    // PPH
    // ======================================================

    const pph =
        labourValue *
        2 /
        100;


    // ======================================================
    // GRAND TOTAL
    // ======================================================

    const grandTotal =
        afterDiscount +
        ppn -
        pph;


    // ======================================================
    // OWN RISK
    // ======================================================

    const ownRisk =
        Math.max(
            0,
            numberValue(
                document.getElementById(
                    "ownRisk"
                )?.value
            )
        );


    // ======================================================
    // TOTAL DITAGIHKAN
    // ======================================================

    const billed =
        Math.max(
            0,
            grandTotal -
            ownRisk
        );


    // ======================================================
    // MATERIAL / LABOUR
    // ======================================================

    const materialElement =
        document.getElementById(
            "materialPercent"
        );


    const labourElement =
        document.getElementById(
            "labourPercent"
        );


    if (materialElement) {

        materialElement.value =
            materialPercent;

    }


    if (labourElement) {

        labourElement.value =
            labourPercent;

    }


    // ======================================================
    // DISPLAY
    // ======================================================

    setText(
        "sumSparepart",
        formatRupiah(
            sparepart
        )
    );


    setText(
        "sumJasa",
        formatRupiah(
            jasa
        )
    );


    setText(
        "sumJasaLain",
        formatRupiah(
            jasaLain
        )
    );


    setText(
        "sumSubtotal",
        formatRupiah(
            subtotal
        )
    );


    setText(
        "sumPpn",
        formatRupiah(
            ppn
        )
    );


    setText(
        "sumLabour",
        formatRupiah(
            labourValue
        )
    );


    setText(
        "sumPph",
        formatRupiah(
            pph
        )
    );


    setText(
        "sumGrandTotal",
        formatRupiah(
            grandTotal
        )
    );


    setText(
        "sumBilled",
        formatRupiah(
            billed
        )
    );


    window.currentEstimasiCalculation = {

        sparepart,

        jasa,

        jasaLain,

        subtotal,

        discount,
        discountSparepartType,
        discountSparepartValue,
        discountSparepart,
        discountJasaType,
        discountJasaValue,
        discountJasa,

        afterDiscount,

        materialPercent,

        materialValue,

        labourPercent,

        labourValue,

        ppnPercent,

        ppnType,

        ppnBase,

        ppn,

        pph,

        ownRisk,

        grandTotal,

        billed

    };

}


// ==========================================================
// SET TEXT
// ==========================================================

function setText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.textContent =
            value;

    }

}


// ==========================================================
// COLLECT SPAREPART
// ==========================================================

function collectSpareparts() {

    const result = [];


    sparepartBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                const name =
                    row.querySelector(
                        ".sparepart-name"
                    )?.value
                    .trim() ||
                    "";


                const sku =
                    row.querySelector(
                        ".sparepart-sku"
                    )?.value
                    .trim() ||
                    "";


                const qty =
                    numberValue(
                        row.querySelector(
                            ".sparepart-qty"
                        )?.value
                    );


                const price =
                    numberValue(
                        row.querySelector(
                            ".sparepart-price"
                        )?.value
                    );


                const discountPercent =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            numberValue(
                                row.querySelector(
                                    ".sparepart-discount-percent"
                                )?.value
                            )
                        )
                    );


                const bruto =
                    Math.max(
                        0,
                        qty * price
                    );


                const discount =
                    bruto *
                    discountPercent /
                    100;


                const total =
                    Math.max(
                        0,
                        bruto - discount
                    );


                if (
                    name ||
                    sku ||
                    qty > 0 ||
                    price > 0
                ) {

                    result.push({

                        name,

                        sku,

                        qty,

                        price,

                        discount,

                        discountPercent,

                        total,

                        // Jangan hilangkan pilihan sumber saat Estimasi disimpan ulang.
                        supply_bengkel: String(row.dataset.supplyBengkel || "BENGKEL").toUpperCase() === "SUPPLY" ? "SUPPLY" : "BENGKEL"

                    });

                }

            }
        );


    return result;


}

// ==========================================================
// COLLECT JASA
// ==========================================================

function collectJasa() {

    const result = [];


    jasaBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                const panel =
                    row.querySelector(
                        ".jasa-panel"
                    )?.value
                    .trim() ||
                    "";


                const jenis =
                    row.querySelector(
                        ".jasa-jenis"
                    )?.value ||
                    "";


                const amount =
                    numberValue(
                        row.querySelector(
                            ".jasa-price"
                        )?.value
                    );


                const discountPercent =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            numberValue(
                                row.querySelector(
                                    ".jasa-discount-percent"
                                )?.value
                            )
                        )
                    );


                const discount =
                    amount *
                    discountPercent /
                    100;


                const total =
                    Math.max(
                        0,
                        amount - discount
                    );


                if (
                    panel ||
                    jenis ||
                    amount > 0
                ) {

                    result.push({

                        panel,

                        jenis,

                        qty: 1,

                        amount,

                        discount,

                        discountPercent,

                        total

                    });

                }

            }
        );


    return result;


}

// ==========================================================
// COLLECT JASA LAIN
// ==========================================================

function collectJasaLain() {

    const result = [];


    jasaLainBody
        .querySelectorAll("tr")
        .forEach(
            row => {

                const name =
                    row.querySelector(
                        ".jasa-lain-name"
                    )?.value
                    .trim() ||
                    "";


                const amount =
                    numberValue(
                        row.querySelector(
                            ".jasa-lain-price"
                        )?.value
                    );


                if (
                    name ||
                    amount > 0
                ) {

                    result.push({

                        name,

                        amount

                    });

                }

            }
        );


    return result;

}


// ==========================================================
// VALIDASI
// ==========================================================

function validateEstimasi() {

    clearMessage();


    // ======================================================
    // CUSTOMER
    // ======================================================

    const customerCodeValue =
        estimasiCustomer.value
            .trim();


    if (!customerCodeValue) {

        showMessage(
            "Customer wajib dipilih dari data Customer.",
            "error"
        );


        return false;

    }


    // ======================================================
    // NO POLISI
    // ======================================================

    const plate =
        document.getElementById(
            "estimasiPlate"
        ).value.trim();


    if (!plate) {

        showMessage(
            "No. Polisi wajib diisi.",
            "error"
        );


        return false;

    }


    // ======================================================
    // MATERIAL
    // ======================================================

    const materialPercent =
        numberValue(
            document.getElementById(
                "materialPercent"
            ).value
        );


    if (
        materialPercent < 0 ||
        materialPercent > 100
    ) {

        showMessage(
            "Material harus antara 0% sampai 100%.",
            "error"
        );


        return false;

    }


    return true;

}


// ==========================================================
// SUBMIT
// ==========================================================

async function submitEstimasi(
    status = "DIBUAT"
) {

    if (
        !validateEstimasi()
    ) {

        return;

    }


    calculateEstimasi();


    const calculation =
        window.currentEstimasiCalculation;


    const customerCodeValue =
        estimasiCustomer.value
            .trim();


    const customers =
        getCustomers();


    const customer =
        customers.find(
            item =>
                customerCode(item) ===
                customerCodeValue
        );


    const customerNameValue =
        customer
            ? customerName(customer)
            : customerSearch.value.trim();


    const now =
        new Date().toISOString();


    // ======================================================
    // NOMOR ESTIMASI
    // ======================================================

    let estimateNumber = "";


    if (editingEstimasiId) {

        const oldData =
            estimasiData.find(
                item =>
                    String(item.id) ===
                    String(editingEstimasiId)
            );


        estimateNumber =
            oldData?.number ||
            generateEstimasiNumber();

    } else {

        estimateNumber =
            generateEstimasiNumber();

    }


    // ======================================================
    // TANGGAL
    // ======================================================

    let estimateDate =
        todayDate();


    if (editingEstimasiId) {

        const oldData =
            estimasiData.find(
                item =>
                    String(item.id) ===
                    String(editingEstimasiId)
            );


        if (oldData?.date) {

            estimateDate =
                formatDate(
                    oldData.date
                );

        }

    }


    // ======================================================
    // ASURANSI
    // ======================================================

    const insurerElement =
        document.getElementById(
            "estimasiInsurer"
        );


    const insurerId =
        insurerElement?.value ||
        "";


    let insurerName = "";


    if (insurerElement) {

        const selectedOption =
            insurerElement.options[
                insurerElement.selectedIndex
            ];


        insurerName =
            selectedOption?.textContent ||
            "";

    }


    // ======================================================
    // DATA ESTIMASI
    // ======================================================

    const estimateData = {

        id:
            editingEstimasiId ||
            Date.now(),


        number:
            estimateNumber,


        date:
            estimateDate,


        status:
            status || "DIBUAT",


        // ==================================================
        // CUSTOMER
        // ==================================================

        customerId:
            document.getElementById(
                "estimasiCustomer"
            )?.value || "",


        customerName:
            customerNameValue,


        customerCode:
            customerCodeValue,


        // ==================================================
        // KENDARAAN
        // ==================================================

        plateNumber:
            document.getElementById(
                "estimasiPlate"
            )?.value.trim() || "",


        // Alias untuk kompatibilitas data lama
        plate:
            document.getElementById(
                "estimasiPlate"
            )?.value.trim() || "",


        brand:
            document.getElementById(
                "estimasiBrand"
            )?.value.trim() || "",


        model:
            document.getElementById(
                "estimasiModel"
            )?.value.trim() || "",


        year:
            document.getElementById(
                "estimasiYear"
            )?.value.trim() || "",


        color:
            document.getElementById(
                "estimasiColor"
            )?.value.trim() || "",


        vin:
            document.getElementById(
                "estimasiVin"
            )?.value.trim() || "",


        engineNumber:
            document.getElementById(
                "estimasiEngine"
            )?.value.trim() || "",


        // Alias untuk kompatibilitas print/data lama
        engine:
            document.getElementById(
                "estimasiEngine"
            )?.value.trim() || "",


        // ==================================================
        // ASURANSI
        // ==================================================

        insurer:
            insurerName,


        insurer_id:
            insurerId,


        claimNumber:
            document.getElementById(
                "claimNumber"
            )?.value.trim() || "",


        polisNumber:
            document.getElementById(
                "PolisNumber"
            )?.value.trim() || "",


        agent:
            document.getElementById(
                "Agent"
            )?.value.trim() || "",


        notes:
            document.getElementById(
                "estimasiNotes"
            )?.value.trim() || "",


        // ==================================================
        // DETAIL
        // ==================================================

        spareparts:
            collectSpareparts(),


        jasa:
            collectJasa(),


        jasaLain:
            collectJasaLain(),


        // ==================================================
        // TOTAL
        // ==================================================

        sparepartTotal:
            calculation.sparepart,


        jasaTotal:
            calculation.jasa,


        jasaLainTotal:
            calculation.jasaLain,


        subtotal:
            calculation.subtotal,


        discount:
            calculation.discount,


        afterDiscount:
            calculation.afterDiscount,


        // ==================================================
        // MATERIAL : LABOUR
        // ==================================================

        materialPercent:
            calculation.materialPercent,


        materialValue:
            calculation.materialValue,


        labourPercent:
            calculation.labourPercent,


        labourValue:
            calculation.labourValue,


        // ==================================================
        // PPN
        // ==================================================

        ppnPercent:
            calculation.ppnPercent,


        ppnType:
            calculation.ppnType,


        ppnBase:
            calculation.ppnBase,


        ppn:
            calculation.ppn,


        // ==================================================
        // PPH
        // ==================================================

        pph:
            calculation.pph,


        // ==================================================
        // OR
        // ==================================================

        ownRisk:
            calculation.ownRisk,


        // ==================================================
        // TOTAL AKHIR
        // ==================================================

        grandTotal:
            calculation.grandTotal,


        billed:
            calculation.billed,

        created_by:
            getCurrentEstimasiUserName(),
        created_by_name:
            getCurrentEstimasiUserName(),

        createdBy:
            currentUser?.id ?? currentUser?.user_id ?? currentUser?.userId ?? currentUser?.username ?? null,

        updatedAt:
            now

    };


    // ======================================================
    // SIMPAN KE DATABASE PUSAT
    // ======================================================
    const apiPayload = {
        customer_id: Number(selectedCustomer?.id || estimateData.customerId) || 0,
        customer_name: estimateData.customerName,
        estimate_date: estimateData.date,
        customer_phone: selectedCustomer?.phone || selectedCustomer?.no_telepon || "",
        customer_type: selectedCustomer?.customer_type || selectedCustomer?.customerType || "INDIVIDUAL",
        customer_address: selectedCustomer?.address || "",
        customer_notes: selectedCustomer?.notes || "",
        plate_number: estimateData.plateNumber,
        mobil_masuk_id: Number(document.getElementById("estimasiMobilMasukId")?.value || 0) || null,
        brand: estimateData.brand,
        model: estimateData.model,
        year: estimateData.year,
        color: estimateData.color,
        vin_number: estimateData.vin,
        engine_number: estimateData.engineNumber,
        insurer_id: Number(estimateData.insurer_id) || null,
        claim_number: estimateData.claimNumber,
        polis_number: estimateData.polisNumber,
        agent: estimateData.agent || "",
        customer_note: estimateData.notes || "",
        spareparts: estimateData.spareparts,
        jasa: estimateData.jasa,
        jasa_lain: estimateData.jasaLain,
        diskon: 0,
        discount_sparepart_type: "PERCENT",
        discount_sparepart_value: 0,
        discount_jasa_type: "PERCENT",
        discount_jasa_value: 0,
        ppn_persen: estimateData.ppnPercent,
        ppn_type: estimateData.ppnType,
        material_percent: estimateData.materialPercent,
        own_risk: estimateData.ownRisk,
        status: status,
        created_by: Number(currentUser?.id || currentUser?.user_id || currentUser?.userId || 0) || 1
    };

    const wasEditingEstimasi = Boolean(editingEstimasiId);
    const historyEstimasiId = editingEstimasiId;
    try {
        const apiUrl = editingEstimasiId
            ? `/api/estimasi/${encodeURIComponent(editingEstimasiId)}`
            : "/api/estimasi";
        const response = await fetch(apiUrl, {
            method: editingEstimasiId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(apiPayload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(result?.message || `HTTP ${response.status}`);
        }

        // Data yang baru dibuat langsung dimasukkan ke daftar terlebih dahulu.
        // Ini penting untuk Service Advisor: jika request GET sesudah POST terlambat
        // atau respons GET kosong, hasil POST tetap langsung terlihat di daftar.
        const savedFromApi = result?.data && typeof result.data === "object"
            ? normalizeEstimasiFromApi(result.data)
            : null;

        // Ambil ulang dari database pusat agar daftar memakai nilai resmi server.
        // Jika GET gagal/kosong, jangan menghapus data yang baru saja berhasil disimpan.
        try {
            const listResponse = await fetch("/api/estimasi", { cache: "no-store" });
            const listResult = await listResponse.json().catch(() => ({}));
            if (listResponse.ok && Array.isArray(listResult?.data)) {
                const refreshed = listResult.data.map(normalizeEstimasiFromApi);
                if (refreshed.length > 0 || !savedFromApi) {
                    estimasiData = refreshed;
                }
            }
        } catch (refreshError) {
            console.warn("Daftar Estimasi belum dapat di-refresh, mempertahankan data hasil simpan.", refreshError);
        }

        if (savedFromApi) {
            const savedId = savedFromApi.id ?? savedFromApi.estimate_id;
            const exists = estimasiData.some(item =>
                String(item.id ?? item.estimate_id ?? "") === String(savedId ?? "")
            );
            if (!exists) {
                estimasiData.unshift(savedFromApi);
            }
        }

        if (wasEditingEstimasi && editingEstimasiOriginal) {
            try {
                const detailResponse = await fetch(`/api/estimasi/${encodeURIComponent(editingEstimasiId)}`, { cache: "no-store" });
                const detailResult = await detailResponse.json().catch(() => ({}));
                if (detailResponse.ok && detailResult?.success && detailResult?.data) {
                    await recordDocumentRevision("ESTIMASI", historyEstimasiId, editingEstimasiOriginal, detailResult.data);
                }
            } catch (historyError) { console.warn("Riwayat revisi Estimasi gagal dicatat:", historyError); }
        }

        renderEstimasi();
        closeEstimasiForm();
        showEstimasiSuccessModal(editingEstimasiId ? "Estimasi berhasil diperbarui." : "Estimasi berhasil dibuat.");
        return;
    } catch (error) {
        myWorkshopAlert("Gagal menyimpan Estimasi ke database pusat.\n\n" + error.message);
        return;
    }

    // ======================================================
    // INSERT / UPDATE
    // ======================================================

    if (
        !editingEstimasiId
    ) {

        estimateData.createdAt =
            now;


        estimasiData.unshift(
            estimateData
        );


    } else {

        const index =
            estimasiData.findIndex(
                item =>
                    String(item.id) ===
                    String(editingEstimasiId)
            );


        if (index !== -1) {

            estimasiData[index] = {

                ...estimasiData[index],

                ...estimateData

            };

        }

    }


    // ======================================================
    // SAVE
    // ======================================================

    saveEstimasiStorage();


    renderEstimasi();


    closeEstimasiForm();

}


window.submitEstimasi =
    submitEstimasi;


// ==========================================================
// STATUS FILTER
// ==========================================================

function statusTextForFilter(item) {
    const sudahAdaWO = Boolean(
        item.hasWo ?? item.has_wo ?? false
    );

    return sudahAdaWO
        ? "SUDAH ADA WO"
        : "DIBUAT";
}


// ==========================================================
// RENDER LIST
// ==========================================================

function ensureEstimasiActionColors() {
    if (document.getElementById("estimasiActionColors")) return;
    const style = document.createElement("style");
    style.id = "estimasiActionColors";
    style.textContent = `
        .estimasi-action-edit { background:#f59e0b !important; border-color:#f59e0b !important; color:#fff !important; }
        .estimasi-action-print { background:#2563eb !important; border-color:#2563eb !important; color:#fff !important; }
        .estimasi-action-delete { background:#dc2626 !important; border-color:#dc2626 !important; color:#fff !important; }
        .estimasi-action-history { background:#16a34a !important; border-color:#16a34a !important; color:#fff !important; }
    `;
    document.head.appendChild(style);
}

function renderEstimasi() {

    ensureEstimasiActionColors();

    if (!estimasiTableBody) {

        return;

    }


    const keyword =
        (
            searchEstimasi?.value ||
            ""
        )
        .trim()
        .toLowerCase();

    const filterStatus =
        String(
            document.getElementById("filterStatusEstimasi")?.value ||
            ""
        )
        .trim()
        .toUpperCase();


    const filtered =
        estimasiData.filter(
            item => {

                const text = [

                    item.number,

                    item.customerName,

                    item.customerCode,

                    item.plateNumber,

                    item.plate,

                    item.brand,

                    item.model

                ]
                .join(" ")
                .toLowerCase();


                // Perpindahan ke Estimasi Selesai ditentukan oleh adanya Tagihan Kuitansi di database,
                // bukan hanya status Estimasi. Jadi Estimasi dengan WO aktif tetap terlihat selama kuitansi belum dibuat.

                const statusMatches =
                    !filterStatus ||
                    statusTextForFilter(item) === filterStatus;

                return (
                    (!keyword || text.includes(keyword)) &&
                    statusMatches
                );

            }
        );


    estimasiTableBody.innerHTML =
        "";


    if (!filtered.length) {

        estimasiTableBody.innerHTML = `

            <tr>

                <td
                    colspan="10"
                    style="
                        text-align:center;
                        padding:30px;
                    "
                >

                    Belum ada data estimasi.

                </td>

            </tr>

        `;


        return;

    }


    filtered.forEach(
        (item, index) => {

            const tr =
                document.createElement(
                    "tr"
                );


            const statusRaw =
                String(item.status || "DIBUAT").toUpperCase();

            // Estimasi yang tersimpan sebagai DRAFT dari versi lama
            // sekarang dianggap berstatus DIBUAT.
            const status =
                statusRaw === "DRAFT"
                    ? "DIBUAT"
                    : statusRaw;

            // Cek dari database apakah Estimasi sudah memiliki WO.
            // Tidak menggunakan localStorage karena status harus tetap benar setelah refresh.
            const sudahAdaWO = Boolean(
                item.hasWo ?? item.has_wo ?? false
            );

            const statusText = sudahAdaWO
                ? "SUDAH ADA WO"
                : "DIBUAT";


            tr.innerHTML = `

                <td>
                    ${index + 1}
                </td>


                <td>

                    <strong>
                        ${escapeHtml(
                            item.number ||
                            "-"
                        )}
                    </strong>

                </td>


                <td>
                    ${formatDate(
                        item.date
                    )}
                </td>


                <td>

                    ${escapeHtml(
                        item.customerName ||
                        "-"
                    )}

                </td>


                <td>

                    ${escapeHtml(
                        item.insurerAlias ||
                        item.insurerName ||
                        "-"
                    )}

                </td>


                <td>

                    ${escapeHtml(

                        [
                            item.brand,

                            item.model

                        ]
                        .filter(Boolean)
                        .join(" ") ||

                        "-"

                    )}

                </td>


                <td>

                    ${escapeHtml(
                        item.plateNumber ||
                        item.plate ||
                        "-"
                    )}

                </td>


                <td>

                    ${escapeHtml(
                        getEstimasiCreatedBy(item)
                    )}

                </td>


                <td>

                    <span
                        class="badge ${String(
                            status
                        ).toLowerCase()}"
                    >

                        ${statusText}

                    </span>

                </td>


                <td>

                    <button
                        type="button"
                        class="btn-secondary estimasi-action-edit"
                        data-edit="${escapeHtml(
                            item.id
                        )}"
                    >
                        ✏️Edit
                    </button>


                    <button
                        type="button"
                        class="btn-secondary estimasi-action-print"
                        data-print="${escapeHtml(
                            item.id
                        )}"
                    >
                        🖨️Print
                    </button>


                    <button
                        type="button"
                        class="btn-secondary estimasi-action-history"
                        data-history="${escapeHtml(
                            item.id
                        )}"
                    >
                        📎Detail
                    </button>


                    ${isCurrentManagerMaster() ? `<button
                        type="button"
                        class="btn-secondary estimasi-action-delete"
                        data-delete="${escapeHtml(item.id)}"
                    >
                        🗑Hapus
                    </button>` : ""}

                </td>

            `;


            // ==================================================
            // EDIT
            // ==================================================

            const editButton =
                tr.querySelector(
                    "[data-edit]"
                );


            if (editButton) {

                editButton.addEventListener(
                    "click",
                    () => {

                        openEstimasiForm(
                            item.id
                        );

                    }
                );

            }


            // ==================================================
            // PRINT
            // ==================================================

            const printButton =
                tr.querySelector(
                    "[data-print]"
                );


            if (printButton) {

                printButton.addEventListener(
                    "click",
                    () => {

                        printEstimasi(
                            item.id
                        );

                    }
                );

            }


            // ==================================================
            // RIWAYAT
            // ==================================================

            const historyButton =
                tr.querySelector(
                    "[data-history]"
                );

            if (historyButton) {
                historyButton.addEventListener(
                    "click",
                    () => {
                        openDocumentHistory(
                            "ESTIMASI",
                            item.id,
                            item.estimate_number ||
                            item.estimateNumber ||
                            "-"
                        );
                    }
                );
            }


            // ==================================================
            // DELETE
            // ==================================================

            const deleteButton =
                tr.querySelector(
                    "[data-delete]"
                );


            if (deleteButton) {

                deleteButton.addEventListener(
                    "click",
                    () => {

                        deleteEstimasi(
                            item.id
                        );

                    }
                );

            }


            estimasiTableBody.appendChild(
                tr
            );

        }
    );

}


// ==========================================================
// PRINT ESTIMASI
// ==========================================================

async function printEstimasi(
    id
) {

    let data =
        estimasiData.find(
            item =>
                String(item.id) ===
                String(id)
        );


    if (!data) {
        myWorkshopAlert("Data estimasi tidak ditemukan.");
        return;
    }

    // Daftar Estimasi hanya memuat header. Ambil detail dari database
    // sebelum mencetak agar sparepart/jasa/totals tidak kosong.
    try {
        const response = await fetch(`/api/estimasi/${encodeURIComponent(id)}`, { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result?.success && result?.data) {
            data = normalizeEstimasiFromApi(result.data);
        }
    } catch (e) {
        console.error("Gagal mengambil detail Estimasi untuk print:", e);
        myWorkshopAlert("Data terbaru Estimasi tidak dapat diambil. Print dibatalkan.");
        return;
    }

    // Untuk hasil PRINT ESTIMASI, selalu gunakan ALIAS Asuransi.
    // Nama lengkap Asuransi tidak boleh ikut tercetak di dokumen ini.
    let printInsurerAlias = String(
        data.insurerAlias ?? data.insurer_alias ?? ""
    ).trim();
    if (!printInsurerAlias && (data.insurerId || data.insurer_id)) {
        try {
            // Endpoint detail /api/asuransi/:id tidak mengembalikan field alias.
            // Gunakan daftar asuransi aktif yang memang mengembalikan alias.
            const insurerResponse = await fetch("/api/asuransi/aktif", { cache: "no-store" });
            const insurerResult = await insurerResponse.json().catch(() => ({}));
            const insurerList = Array.isArray(insurerResult)
                ? insurerResult
                : (Array.isArray(insurerResult?.data) ? insurerResult.data : []);
            const insurer = insurerList.find(item =>
                String(item?.id ?? "") === String(data.insurerId ?? data.insurer_id ?? "")
            );
            printInsurerAlias = String(
                insurer?.alias ?? insurer?.insurer_alias ?? insurer?.insurerAlias ?? ""
            ).trim();
        } catch (e) {
            console.warn("Gagal mengambil Alias Asuransi untuk print Estimasi:", e);
        }
    }

    await recordDocumentPrint("ESTIMASI", id);

    const workshopHeader = await getWorkshopPrintHeader();

    const spareparts =
        Array.isArray(data.spareparts)
            ? data.spareparts
            : [];


    const jasa =
        Array.isArray(data.jasa)
            ? data.jasa
            : [];


    const jasaLain =
        Array.isArray(data.jasaLain)
            ? data.jasaLain
            : [];

    const hasPrintValue = (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        String(value).trim() !== "0";

    // Abaikan baris placeholder yang kosong agar section kosong tidak ikut print.
    const printSpareparts = spareparts.filter(item =>
        hasPrintValue(item.name ?? item.part_name ?? item.partName) ||
        hasPrintValue(item.sku ?? item.part_number ?? item.partNumber) ||
        hasPrintValue(item.qty ?? item.quantity) ||
        hasPrintValue(item.price ?? item.unit_price)
    );
    const printJasa = jasa.filter(item =>
        hasPrintValue(item.panel ?? item.panel_name ?? item.panelName) ||
        hasPrintValue(item.jenis ?? item.service_type ?? item.serviceType) ||
        hasPrintValue(item.amount ?? item.unit_price)
    );
    const printJasaLain = jasaLain.filter(item =>
        hasPrintValue(item.name ?? item.service_name ?? item.serviceName) ||
        hasPrintValue(item.amount ?? item.unit_price ?? item.total_price)
    );


    // TOTAL PER SECTION UNTUK PRINT ESTIMASI
    // Masing-masing section menampilkan subtotal berdasarkan nilai barisnya.
    const totalSparepartPrint = printSpareparts.reduce(
        (sum, item) =>
            sum +
            (
                Number(item.total ?? item.total_price) ||
                Math.max(
                    0,
                    numberValue(item.qty ?? item.quantity) *
                    numberValue(item.price ?? item.unit_price) -
                    numberValue(item.discount ?? item.discount_amount)
                )
            ),
        0
    );

    const totalJasaPrint = printJasa.reduce(
        (sum, item) =>
            sum +
            (
                Number(item.total ?? item.total_price) ||
                Math.max(
                    0,
                    numberValue(item.amount ?? item.unit_price) -
                    numberValue(item.discount ?? item.discount_amount)
                )
            ),
        0
    );

    const totalJasaLainPrint = printJasaLain.reduce(
        (sum, item) =>
            sum +
            (
                Number(item.amount ?? item.unit_price ?? item.total_price) || 0
            ),
        0
    );


    const ppnTypeText =
        data.ppnType ===
        "SPAREPART_JASA"

            ? "Atas Sparepart dan Jasa"

            : "Atas Lengkap";


    // (discount/discount_amount), sedangkan input Estimasi memakai persen.
    // Saat print, selalu turunkan kembali persentasenya dari nilai bruto
    // jika field discountPercent belum tersedia.
    const getSparepartDiscountPercent = (item) => {
        const storedPercent = item.discountPercent ?? item.discount_percent;
        if (storedPercent !== null && storedPercent !== undefined && storedPercent !== "") {
            return Math.max(0, Math.min(100, numberValue(storedPercent)));
        }

        const qty = numberValue(item.qty ?? item.quantity);
        const price = numberValue(item.price ?? item.unit_price);
        const bruto = qty * price;
        const discount = numberValue(item.discount ?? item.discount_amount);
        return bruto > 0
            ? Math.max(0, Math.min(100, (discount / bruto) * 100))
            : 0;
    };

    const getJasaDiscountPercent = (item) => {
        const storedPercent = item.discountPercent ?? item.discount_percent;
        if (storedPercent !== null && storedPercent !== undefined && storedPercent !== "") {
            return Math.max(0, Math.min(100, numberValue(storedPercent)));
        }

        const price = numberValue(item.amount ?? item.unit_price);
        const discount = numberValue(item.discount ?? item.discount_amount);
        return price > 0
            ? Math.max(0, Math.min(100, (discount / price) * 100))
            : 0;
    };

    const sparepartRows =
        printSpareparts.length

            ? printSpareparts.map(
                (item, index) => `

                    <tr>

                        <td class="center">
                            ${index + 1}
                        </td>

                        <td>
                            ${escapeHtml(
                                item.name ?? item.part_name ?? "-"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                item.sku ?? item.part_number ?? "-"
                            )}
                        </td>

                        <td class="center">
                            ${numberValue(item.qty ?? item.quantity)}
                        </td>

                        <td class="right">
                            ${formatRupiah(
                                item.price ?? item.unit_price
                            )}
                        </td>

                        <td class="center">
                            ${getSparepartDiscountPercent(item)}%
                        </td>

                        <td class="right">
                            ${formatRupiah(
                                item.total ?? item.total_price ??
                                Math.max(
                                    0,
                                    numberValue(item.qty ?? item.quantity) *
                                    numberValue(item.price ?? item.unit_price) -
                                    numberValue(item.discount ?? item.discount_amount)
                                )
                            )}
                        </td>

                    </tr>

                `
            ).join("")

            : `

                <tr>

                    <td
                        colspan="7"
                        class="empty"
                    >
                        Tidak ada sparepart.
                    </td>

                </tr>

            `;


    const jasaRows =
        printJasa.length

            ? printJasa.map(
                (item, index) => `

                    <tr>

                        <td class="center">
                            ${index + 1}
                        </td>

                        <td>
                            ${escapeHtml(
                                item.panel ?? item.panel_name ?? "-"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                item.jenis ?? item.service_type ?? "-"
                            )}
                        </td>

                        <td class="right">
                            ${formatRupiah(
                                item.amount ?? item.unit_price
                            )}
                        </td>

                        <td class="center">
                            ${getJasaDiscountPercent(item)}%
                        </td>

                        <td class="right">
                            ${formatRupiah(
                                item.total ??
                                item.total_price ??
                                Math.max(
                                    0,
                                    numberValue(item.amount ?? item.unit_price) -
                                    numberValue(item.discount ?? item.discount_amount)
                                )
                            )}
                        </td>

                    </tr>

                `
            ).join("")

            : `

                <tr>

                    <td
                        colspan="5"
                        class="empty"
                    >
                        Tidak ada jasa.
                    </td>

                </tr>

            `;


    const jasaLainRows =
        printJasaLain.length

            ? printJasaLain.map(
                (item, index) => `

                    <tr>

                        <td class="center">
                            ${index + 1}
                        </td>

                        <td>
                            ${escapeHtml(
                                item.name ?? item.service_name ?? "-"
                            )}
                        </td>

                        <td class="right">
                            ${formatRupiah(
                                item.amount ?? item.unit_price ?? item.total_price
                            )}
                        </td>

                    </tr>

                `
            ).join("")

            : `

                <tr>

                    <td
                        colspan="3"
                        class="empty"
                    >
                        Tidak ada jasa lain-lain.
                    </td>

                </tr>

            `;


    const printWindow =
        window.open(
            "",
            "_blank",
            "width=1000,height=800"
        );


    if (!printWindow) {

        myWorkshopAlert(
            "Popup diblokir browser. Izinkan popup untuk MyWorkshop."
        );

        return;

    }


    printWindow.document.open();


    printWindow.document.write(`

<!DOCTYPE html>

<html lang="id">

<head>

<meta charset="UTF-8">

<title>MyWorkshop</title>

<style>

.header > div:first-child { margin-bottom: 4px !important; }

@page {

    size: A4;

    margin: 10mm;

}

* {

    box-sizing: border-box;

}

body {

    margin: 0;

    padding: 0;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    font-size: 10px;

    color: #222;

    background: white;

}

.page {

    width: 100%;

}

.header {

    display: flex;

    justify-content: space-between;

    align-items: flex-start;

    border-bottom: 0;

    padding-bottom: 10px;

    margin-bottom: 12px;

}

.company {

    font-size: 21px;

    font-weight: 700;

    letter-spacing: 1px;

}

.company-sub {

    margin-top: 3px;

    font-size: 9px;

    color: #555;

}

.title {

    text-align: right;

}

.title h1 {

    margin: 0;

    font-size: 17px;

    letter-spacing: .5px;

}

.title p {

    margin: 4px 0 0;

    font-size: 10px;

}

.info-grid {

    display: grid;

    grid-template-columns:
        1fr 1fr;

    gap: 12px;

    margin-bottom: 12px;

}

.info-box {

    border: 1px solid #bbb;

    border-radius: 4px;

    padding: 8px;

}

.info-box h3 {

    margin: 0 0 7px;

    font-size: 11px;

    border-bottom: 1px solid #ddd;

    padding-bottom: 5px;

}

.info-row {

    display: grid;

    grid-template-columns:
        105px 1fr;

    margin-bottom: 4px;

}

.info-label {

    color: #555;

}

.info-value {

    font-weight: 600;

}

.section {

    margin-top: 11px;

}

.section-title {

    font-size: 11px;

    font-weight: 700;

    background: #f1f1f1;

    border: 1px solid #bbb;

    padding: 6px 7px;

}

table {

    width: 100%;

    border-collapse: collapse;

}

.sparepart-print-table {

    table-layout: fixed;

}

.sparepart-print-table th,
.sparepart-print-table td {

    overflow-wrap: anywhere;

}

th {

    background: #e9e9e9;

    font-weight: 700;

}

th,
td {

    border: 1px solid #bbb;

    padding: 5px 6px;

    vertical-align: middle;

}

.center {

    text-align: center;

}

.right {

    text-align: right;

}

.empty {

    text-align: center;

    color: #777;

    font-style: italic;

}

.total-table {

    width: 48%;

    margin-left: auto;

    margin-top: 12px;

}

.total-table td {

    padding: 5px 7px;

}

.total-label {

    font-weight: 600;

}

.total-final td {

    font-size: 12px;

    font-weight: 700;

    border-top: 2px solid #222;

}

.notes {

    margin-top: 12px;

    border: 1px solid #bbb;

    padding: 8px;

    min-height: 45px;

}

.notes-title {

    font-weight: 700;

    margin-bottom: 5px;

}

.signature {

    margin-top: 30px;

    display: grid;

    grid-template-columns:
        1fr 1fr;

    gap: 80px;

}

.signature-box {

    text-align: center;

    min-height: 65px;

}

.signature-line {

    margin-top: 45px;

    border-bottom: 1px solid #555;

}

.footer {

    margin-top: 18px;

    padding-top: 6px;

    border-top: 1px solid #bbb;

    text-align: center;

    font-size: 8px;

    color: #777;

}

.section-total-label {
    font-weight: 700;
    background: #f5f5f5;
    padding: 6px 8px;
}

.section-total-value {
    font-weight: 700;
    background: #f5f5f5;
    padding: 6px 8px;
}

.no-print {

    margin: 10px 0;

    text-align: center;

}

.no-print button {

    padding: 8px 18px;

    border: 0;

    border-radius: 4px;

    cursor: pointer;

}

@media print {

    .no-print {

        display: none !important;

    }

    /* Subtotal section harus tampil satu kali, setelah item terakhir,
       bukan diulang sebagai footer pada setiap halaman cetak. */
    .section table tfoot {

        display: table-row-group;

    }

}

</style>

</head>

<body>

<div class="no-print">

    <button onclick="window.print()">
        Print / Simpan PDF
    </button>

</div>

<div class="page">

    <!-- HEADER -->

    <div class="header">

        ${workshopHeader}

        <div class="title">

            <h1>
                ESTIMASI PERBAIKAN KENDARAAN
            </h1>

            <p>
                No. Estimasi:
                <strong>
                    ${escapeHtml(
                        data.number || "-"
                    )}
                </strong>
            </p>

            <p>
                Tanggal:
                <strong>
                    ${formatDate(
                        data.date
                    )}
                </strong>
            </p>

        </div>

    </div>


    <!-- IDENTITAS -->

    <div class="info-grid">


        <!-- CUSTOMER -->

        <div class="info-box">

            <h3>
                IDENTITAS CUSTOMER
            </h3>


            <div class="info-row">

                <div class="info-label">
                    Nama Customer
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.customerName ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    Asuransi
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        printInsurerAlias ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    No. Klaim
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.claimNumber ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    No. Polis
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.polisNumber ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    Agent
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.agent ||
                        "-"
                    )}
                </div>

            </div>

        </div>


        <!-- KENDARAAN -->

        <div class="info-box">

            <h3>
                DATA KENDARAAN
            </h3>


            <div class="info-row">

                <div class="info-label">
                    No. Polisi
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.plateNumber ||
                        data.plate ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    Kendaraan
                </div>

                <div class="info-value">

                    ${escapeHtml(

                        [
                            data.brand,
                            data.model
                        ]
                        .filter(Boolean)
                        .join(" ") ||
                        "-"

                    )}

                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    Tahun
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.year ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    Warna
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.color ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    No. Rangka
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.vin ||
                        "-"
                    )}
                </div>

            </div>


            <div class="info-row">

                <div class="info-label">
                    No. Mesin
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        data.engineNumber ||
                        data.engine ||
                        "-"
                    )}
                </div>

            </div>

        </div>

    </div>


    ${printSpareparts.length ? `<!-- SPAREPART -->

    <div class="section">

        <div class="section-title">
            PERGANTIAN SPAREPART
        </div>

        <table class="sparepart-print-table">

            <colgroup>
                <col style="width:5%">
                <col style="width:27%">
                <col style="width:17%">
                <col style="width:8%">
                <col style="width:15%">
                <col style="width:10%">
                <col style="width:18%">
            </colgroup>

            <thead>

                <tr>

                    <th>No</th>
                    <th>Nama Sparepart</th>
                    <th>No. Part / SKU</th>
                    <th>Qty</th>
                    <th>Harga</th>
                    <th>Diskon (%)</th>
                    <th>Jumlah</th>

                </tr>

            </thead>

            <tbody>

                ${sparepartRows}

            </tbody>

            <tfoot>
                <tr>
                    <td colspan="6" class="right section-total-label">
                        TOTAL PERGANTIAN SPAREPART
                    </td>
                    <td class="right section-total-value">
                        ${formatRupiah(totalSparepartPrint)}
                    </td>
                </tr>
            </tfoot>

        </table>

    </div>


    ` : ""}

    ${printJasa.length ? `<!-- JASA -->

    <div class="section">

        <div class="section-title">
            JASA PENGECATAN / PERBAIKAN
        </div>

        <table>

            <thead>

                <tr>

                    <th width="5%">
                        No
                    </th>

                    <th>
                        Nama Panel
                    </th>

                    <th width="15%">
                        Jenis
                    </th>

                    <th width="18%">
                        Harga
                    </th>

                    <th width="10%">
                        Diskon (%)
                    </th>

                    <th width="18%">
                        Jumlah
                    </th>

                </tr>

            </thead>

            <tbody>

                ${jasaRows}

            </tbody>

            <tfoot>
                <tr>
                    <td colspan="5" class="right section-total-label">
                        TOTAL JASA PENGECATAN / PERBAIKAN
                    </td>
                    <td class="right section-total-value">
                        ${formatRupiah(totalJasaPrint)}
                    </td>
                </tr>
            </tfoot>

        </table>

    </div>


    ` : ""}

    ${printJasaLain.length ? `<!-- JASA LAIN -->

    <div class="section">

        <div class="section-title">
            JASA LAIN-LAIN
        </div>

        <table>

            <thead>

                <tr>

                    <th width="5%">
                        No
                    </th>

                    <th>
                        Nama
                    </th>

                    <th width="25%">
                        Jumlah
                    </th>

                </tr>

            </thead>

            <tbody>

                ${jasaLainRows}

            </tbody>

            <tfoot>
                <tr>
                    <td colspan="2" class="right section-total-label">
                        TOTAL JASA LAIN-LAIN
                    </td>
                    <td class="right section-total-value">
                        ${formatRupiah(totalJasaLainPrint)}
                    </td>
                </tr>
            </tfoot>

        </table>

    </div>


    ` : ""}

    <!-- TOTAL -->

    <table class="total-table">

        <tr>

            <td class="total-label">
                Jumlah
            </td>

            <td class="right">
                ${formatRupiah(
                    data.subtotal
                )}
            </td>

        </tr>


        ${Number(data.discount || 0) > 0 ? `
        <tr>
            <td class="total-label">Total Diskon</td>
            <td class="right">- ${formatRupiah(data.discount)}</td>
        </tr>
        <tr>
            <td class="total-label">Setelah Diskon</td>
            <td class="right">${formatRupiah(data.afterDiscount)}</td>
        </tr>` : ""}


        <tr>

            <td class="total-label">
                PPN
                ${escapeHtml(
                    data.ppnPercent || 0
                )}%
            </td>

            <td class="right">
                ${formatRupiah(
                    data.ppn
                )}
            </td>

        </tr>


        <tr>

            <td class="total-label">
                Dasar PPN
            </td>

            <td class="right">
                ${escapeHtml(
                    ppnTypeText
                )}
            </td>

        </tr>


        <tr>

            <td class="total-label">
                Material : Labour
            </td>

            <td class="right">

                ${escapeHtml(
                    data.materialPercent ?? 0
                )}%
                :
                ${escapeHtml(
                    data.labourPercent ?? 100
                )}%

            </td>

        </tr>


        <tr>

            <td class="total-label">
                Nilai Labour
            </td>

            <td class="right">
                ${formatRupiah(
                    data.labourValue
                )}
            </td>

        </tr>


        <tr>

            <td class="total-label">
                PPH 2%
            </td>

            <td class="right">
                - ${formatRupiah(
                    data.pph
                )}
            </td>

        </tr>


        <tr>

            <td class="total-label">
                Grand Total
            </td>

            <td class="right">
                ${formatRupiah(
                    data.grandTotal
                )}
            </td>

        </tr>


        <tr>

            <td class="total-label">
                Own Risk
            </td>

            <td class="right">
                - ${formatRupiah(
                    data.ownRisk
                )}
            </td>

        </tr>


        <tr class="total-final">

            <td>
                TOTAL DITAGIHKAN
            </td>

            <td class="right">
                ${formatRupiah(
                    data.billed
                )}
            </td>

        </tr>

    </table>


    <!-- CATATAN ESTIMASI -->

    <div class="notes">

        <div class="notes-title">
            CATATAN ESTIMASI
        </div>

        <div>
            ${escapeHtml(
                data.notes ??
                data.customerNote ??
                data.customer_note ??
                "-"
            ).replace(
                /\n/g,
                "<br>"
            )}
        </div>

    </div>


    <!-- TANDA TANGAN -->

    <div class="signature">

        <div class="signature-box">

            Dibuat Oleh

            <div class="signature-line">
            </div>

        </div>


        <div class="signature-box">

            Customer

            <div class="signature-line">
            </div>

        </div>

    </div>


    <div class="footer">

        Dokumen Estimasi - MyWorkshop

    </div>


</div>


<script>

window.onload = function () {

    setTimeout(
        function () {

            window.print();

        },
        300
    );

};

</script>


</body>

</html>

    `);


    printWindow.document.close();

}


window.printEstimasi =
    printEstimasi;


// ==========================================================
// DELETE
// ==========================================================

function showEstimasiDeleteModal(data) {
    return new Promise(resolve => {
        const old = document.getElementById("mwEstimasiDeleteModal");
        if (old) old.remove();
        const modal = document.createElement("div");
        modal.id = "mwEstimasiDeleteModal";
        const number = escapeHtml(data.number || data.estimate_number || "-");
        const renderReason = () => {
            modal.innerHTML = `
                <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                    <div style="background:#fff;width:min(460px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                        <h3 style="margin:0 0 12px;color:#14213d;">Alasan Hapus Estimasi</h3>
                        <p style="margin:0 0 16px;line-height:1.5;">Sebelum memasukkan password, tuliskan alasan penghapusan Estimasi <strong>${number}</strong>.</p>
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
                        <h3 style="margin:0 0 12px;color:#14213d;">Password Hapus Estimasi</h3>
                        <p style="margin:0 0 16px;line-height:1.5;">Alasan sudah dicatat. Masukkan Password Hapus Estimasi untuk melanjutkan penghapusan <strong>${number}</strong>.</p>
                        <label style="display:block;font-weight:700;margin-bottom:7px;">Password Hapus Estimasi</label>
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

async function deleteEstimasi(id) {
    if (!isCurrentManagerMaster()) {
        showMessage("Hanya Manager Master yang dapat menghapus Estimasi.", "error");
        return;
    }
    const data = estimasiData.find(item => String(item.id) === String(id));
    if (!data) return;
    const deletion = await showEstimasiDeleteModal(data);
    if (deletion === null) return;
    try {
        const response = await fetch(`/api/estimasi/${encodeURIComponent(id)}`, {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: deletion.password, reason: deletion.reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) throw new Error(result?.message || "Gagal menghapus estimasi.");
        estimasiData = estimasiData.filter(item => String(item.id) !== String(id));
        renderEstimasi();
        showMessage(`Estimasi ${data.number || ""} berhasil dihapus.`, "success");
    } catch (error) {
        console.error("DELETE ESTIMASI ERROR:", error);
        showMessage(error.message || "Gagal menghapus estimasi.", "error");
    }
}

window.deleteEstimasi =
    deleteEstimasi;


// ==========================================================
// MESSAGE
// ==========================================================

function showEstimasiSuccessModal(message) {
    return window.myWorkshopAlert(message, "success");
}

function showMessage(
    message,
    type = ""
) {

    const element =
        document.getElementById(
            "estimasiMessage"
        );


    if (!element) {
        // Fallback agar pesan error/sukses tetap terlihat walaupun
        // elemen #estimasiMessage tidak tersedia pada halaman.
        if (typeof window.myWorkshopAlert === "function") {
            window.myWorkshopAlert(message, type === "success" ? "success" : "error");
        } else {
            const old = document.getElementById("mwEstimasiMessageFallback");
            if (old) old.remove();
            const modal = document.createElement("div");
            modal.id = "mwEstimasiMessageFallback";
            modal.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;";
            modal.innerHTML = `<div style="width:min(440px,100%);background:#fff;border-radius:10px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:Arial,sans-serif"><div style="font-size:18px;font-weight:700;margin-bottom:10px">Informasi</div><div style="white-space:pre-line;line-height:1.5">${String(message ?? "").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}</div><div style="text-align:right;margin-top:20px"><button type="button" style="padding:9px 22px;background:#2563eb;color:#fff;border:0;border-radius:7px;font-weight:700;cursor:pointer">OK</button></div></div>`;
            document.body.appendChild(modal);
            modal.querySelector("button")?.addEventListener("click", () => modal.remove());
        }
        return;
    }


    element.textContent =
        message;


    element.className =
        "message " +
        type;

}


function clearMessage() {

    const element =
        document.getElementById(
            "estimasiMessage"
        );


    if (!element) {

        return;

    }


    element.textContent =
        "";


    element.className =
        "message";

}


// ==========================================================
// CUSTOMER EVENTS
// ==========================================================

if (customerSearch) {

    customerSearch.addEventListener(
        "input",
        function (event) {

            showCustomerResults(
                event.target.value
            );

        }
    );


    customerSearch.addEventListener(
        "focus",
        function (event) {

            showCustomerResults(
                event.target.value
            );

        }
    );

}


// ==========================================================
// CLOSE CUSTOMER RESULT
// ==========================================================

document.addEventListener(
    "click",
    event => {

        if (

            customerResults &&

            customerSearch &&

            !customerResults.contains(
                event.target
            ) &&

            event.target !==
                customerSearch

        ) {

            customerResults.classList.remove(
                "show"
            );

        }

    }
);


// ==========================================================
// SEARCH ESTIMASI
// ==========================================================

if (searchEstimasi) {

    searchEstimasi.addEventListener(
        "input",
        renderEstimasi
    );

}

const filterStatusEstimasi =
    document.getElementById("filterStatusEstimasi");

if (filterStatusEstimasi) {

    filterStatusEstimasi.addEventListener(
        "change",
        renderEstimasi
    );

}


// ==========================================================
// PERHITUNGAN EVENTS
// ==========================================================

[

    "ppnPercent",

    "ppnType",

    "materialPercent",

    "ownRisk"

].forEach(
    id => {

        const element =
            document.getElementById(
                id
            );


        if (element) {

            element.addEventListener(
                "input",
                calculateEstimasi
            );


            element.addEventListener(
                "change",
                calculateEstimasi
            );

        }

    }
);


// ==========================================================
// MODAL CLICK OUTSIDE
// ==========================================================

if (estimasiModal) {

    estimasiModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                estimasiModal
            ) {

                closeEstimasiForm();

            }

        }
    );

}


// ==========================================================
// ESCAPE MODAL
// ==========================================================

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Escape" &&
            estimasiModal?.classList.contains(
                "show"
            )
        ) {

            closeEstimasiForm();

        }

    }
);


// ==========================================================
// INIT ESTIMASI
// ==========================================================

async function initEstimasi() {
    await loadEstimasi();
    renderEstimasi();
}


// ==========================================================
// EXPORT GLOBAL
// ==========================================================

window.openEstimasiForm =
    openEstimasiForm;

window.closeEstimasiForm =
    closeEstimasiForm;

window.addSparepartRow =
    addSparepartRow;

window.addJasaRow =
    addJasaRow;

window.addJasaLainRow =
    addJasaLainRow;

window.calculateEstimasi =
    calculateEstimasi;

window.renderEstimasi =
    renderEstimasi;

window.submitEstimasi =
    submitEstimasi;

window.deleteEstimasi =
    deleteEstimasi;

window.printEstimasi =
    printEstimasi;


// ==========================================================
// DOM READY
// ==========================================================

document.addEventListener(
    "DOMContentLoaded",
    async function () {

        await loadCustomersForEstimasi();

        await loadAsuransiForEstimasi();
        await loadMobilMasukForEstimasi();

        const plateInput = document.getElementById("estimasiPlate");
        if (plateInput) {
            plateInput.addEventListener("input", applyMobilMasukToEstimasi);
            plateInput.addEventListener("change", applyMobilMasukToEstimasi);
        }

        const insurerSelect =
            document.getElementById("estimasiInsurer");

        if (insurerSelect) {
            insurerSelect.addEventListener(
                "change",
                applyInsurerMaterialSplit
            );
        }

        initEstimasi();


        const btn =
            document.getElementById(
                "btnBuatEstimasi"
            );


        if (btn) {

            btn.onclick = function () {

                openEstimasiForm();

            };

        }

    }
);

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
            const changeHtml=changes.length?`<div>${changes.map(c=>`<div class="document-history-change"><b>${escapeDocumentHistoryText(documentHistoryFieldLabel(c.field))}</b><span>Sebelum: ${escapeDocumentHistoryText(c.before)}</span><span>Sesudah: ${escapeDocumentHistoryText(c.after)}</span></div>`).join("")}</div>`:"";
            return `<div class="document-history-event"><div class="document-history-event-head"><span class="document-history-event-title">${title}</span><span class="document-history-event-meta">${escapeDocumentHistoryText(row.created_at||"-")} · ${escapeDocumentHistoryText(row.created_by_name||"-")}</span></div>${changeHtml}</div>`;
        }).join("");
    }catch(e){body.innerHTML=`<div class="document-history-empty">Gagal mengambil riwayat: ${escapeDocumentHistoryText(e.message)}</div>`}
}
function escapeDocumentHistoryText(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
window.openDocumentHistory = openDocumentHistory;
window.closeDocumentHistory = closeDocumentHistory;
