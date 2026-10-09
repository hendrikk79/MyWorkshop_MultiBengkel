// ============================================================
// MYWORKSHOP - MASTER DATA ASURANSI
// ============================================================

let asuransiData = [];
let editingAsuransiId = null;


// ============================================================
// INIT
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        initAsuransi();

    }
);


// ============================================================
// INIT ASURANSI
// ============================================================

async function initAsuransi() {

    loadSidebarUser();

    setupAsuransiEvents();

    await loadAsuransi();

}


// ============================================================
// SIDEBAR USER
// ============================================================

function loadSidebarUser() {

    try {

        const raw =
            localStorage.getItem(
                "myworkshop_user"
            );

        if (!raw) {

            window.location.href = "/";

            return;

        }

        const user =
            JSON.parse(raw);

        const name =
            user.full_name ||
            user.name ||
            user.username ||
            "User";

        let role = "User";

        if (
            user.role &&
            typeof user.role === "object"
        ) {

            role =
                user.role.name ||
                user.role_name ||
                "User";

        }

        else if (
            typeof user.role === "string"
        ) {

            role =
                user.role;

        }

        const avatar =
            document.getElementById(
                "sidebarAvatar"
            );

        const userName =
            document.getElementById(
                "sidebarUser"
            );

        const userRole =
            document.getElementById(
                "sidebarRole"
            );

        if (avatar) {

            avatar.textContent =
                getInitials(name);

        }

        if (userName) {

            userName.textContent =
                name;

        }

        if (userRole) {

            userRole.textContent =
                role;

        }

    }

    catch (error) {

        console.error(
            "LOAD USER ERROR:",
            error
        );

        localStorage.removeItem(
            "myworkshop_user"
        );

        window.location.href = "/";

    }

}


// ============================================================
// INITIAL
// ============================================================

function getInitials(name) {

    const words =
        String(name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);

    if (!words.length) {

        return "U";

    }

    if (words.length === 1) {

        return words[0]
            .substring(0, 2)
            .toUpperCase();

    }

    return (
        words[0].charAt(0) +
        words[1].charAt(0)
    ).toUpperCase();

}


// ============================================================
// LOGOUT
// ============================================================

function logout() {

    localStorage.removeItem(
        "myworkshop_user"
    );

    window.location.href = "/";

}


// ============================================================
// EVENT
// ============================================================

function setupAsuransiEvents() {

    const btnTambah =
        document.getElementById(
            "btnTambahAsuransi"
        );

    const btnClose =
        document.getElementById(
            "btnCloseAsuransi"
        );

    const btnBatal =
        document.getElementById(
            "btnBatalAsuransi"
        );

    const form =
        document.getElementById(
            "asuransiForm"
        );

    const search =
        document.getElementById(
            "searchAsuransi"
        );

    const modal =
        document.getElementById(
            "asuransiModal"
        );


    // TAMBAH

    if (btnTambah) {

        btnTambah.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                openAsuransiForm();

            }
        );

    }


    // CLOSE X

    if (btnClose) {

        btnClose.addEventListener(
            "click",
            function () {

                closeAsuransiForm();

            }
        );

    }


    // BATAL

    if (btnBatal) {

        btnBatal.addEventListener(
            "click",
            function () {

                closeAsuransiForm();

            }
        );

    }


    // SUBMIT

    if (form) {

        form.addEventListener(
            "submit",
            saveAsuransi
        );

    }


    // SEARCH

    if (search) {

        search.addEventListener(
            "input",
            function () {

                renderAsuransi(
                    this.value
                );

            }
        );

    }


    const materialField =
        document.getElementById(
            "asuransiMaterialPercent"
        );

    const labourField =
        document.getElementById(
            "asuransiLabourPercent"
        );

    if (materialField && labourField) {
        const syncSplit = function () {
            let value = Number(materialField.value);
            if (!Number.isFinite(value)) value = 0;
            value = Math.max(0, Math.min(100, value));
            materialField.value = value;
            labourField.value = 100 - value;
        };
        materialField.addEventListener("input", syncSplit);
        materialField.addEventListener("change", syncSplit);
    }


    // CLICK BACKDROP

    if (modal) {

        modal.addEventListener(
            "click",
            function (event) {

                if (
                    event.target === modal
                ) {

                    closeAsuransiForm();

                }

            }
        );

    }

}


// ============================================================
// LOAD DATA
// ============================================================

async function loadAsuransi() {

    const tbody =
        document.getElementById(
            "asuransiTableBody"
        );


    if (tbody) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="10"
                    style="text-align:center;padding:30px;"
                >
                    Memuat data asuransi...
                </td>
            </tr>
        `;

    }


    try {

        const response =
            await fetch(
                "/api/asuransi",
                {
                    method: "GET",
                    headers: {
                        "Accept":
                            "application/json"
                    },
                    cache: "no-store"
                }
            );


        /*
         * JANGAN LANGSUNG response.json()
         *
         * Kita baca text terlebih dahulu.
         * Ini mencegah error:
         *
         * Unexpected token '<'
         */

        const text =
            await response.text();


        let result;

        try {

            result =
                JSON.parse(text);

        }

        catch (jsonError) {

            console.error(
                "RESPON API BUKAN JSON:",
                text
            );

            throw new Error(
                "API /api/asuransi tidak mengembalikan JSON. Pastikan server.js yang sudah direvisi sedang berjalan."
            );

        }


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Gagal mengambil data asuransi."
            );

        }


        if (
            Array.isArray(result)
        ) {

            asuransiData =
                result;

        }

        else if (
            Array.isArray(result.data)
        ) {

            asuransiData =
                result.data;

        }

        else {

            asuransiData = [];

        }


        renderAsuransi();


    }

    catch (error) {

        console.error(
            "LOAD ASURANSI ERROR:",
            error
        );

        asuransiData = [];

        if (tbody) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="10"
                        style="text-align:center;padding:30px;color:#b42318;"
                    >
                        Gagal mengambil data asuransi.
                        <br>
                        <br>
                        ${escapeHtml(
                            error.message
                        )}
                    </td>
                </tr>
            `;

        }

    }

}


// ============================================================
// RENDER
// ============================================================

function renderAsuransi(
    keyword = ""
) {

    const tbody =
        document.getElementById(
            "asuransiTableBody"
        );


    if (!tbody) {

        return;

    }


    const searchKeyword =
        String(keyword || "")
            .toLowerCase()
            .trim();


    const data =
        asuransiData.filter(
            function (item) {

                const code =
                    item.code ||
                    item.kode ||
                    "";

                const name =
                    item.name ||
                    item.nama ||
                    "";

                const alias =
                    item.alias ||
                    item.asuransi_alias ||
                    "";

                const address =
                    item.address ||
                    item.alamat ||
                    "";

                const phone =
                    item.phone ||
                    item.telephone ||
                    "";

                const npwp =
                    item.npwp ||
                    "";

                const materialPercent =
                    Math.max(0, Math.min(100, Number(item.material_percent ?? item.materialPercent ?? 0) || 0));

                const labourPercent =
                    100 - materialPercent;

                const notes =
                    item.notes ||
                    item.catatan ||
                    "";


                const text =
                    (
                        code +
                        " " +
                        name +
                        " " +
                        alias +
                        " " +
                        address +
                        " " +
                        phone +
                        " " +
                        notes
                    )
                    .toLowerCase();


                return text.includes(
                    searchKeyword
                );

            }
        );


    if (!data.length) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="11"
                    style="text-align:center;padding:30px;"
                >
                    Belum ada data asuransi.
                    <br>
                    <br>
                    Klik
                    <strong>
                        + Tambah Asuransi
                    </strong>
                    untuk menambahkan data.
                </td>
            </tr>
        `;

        return;

    }


    tbody.innerHTML =
        data.map(
            function (item, index) {

                const id =
                    item.id;


                const code =
                    item.code ||
                    item.kode ||
                    "-";


                const name =
                    item.name ||
                    item.nama ||
                    "-";


                const alias =
                    item.alias ||
                    item.asuransi_alias ||
                    "";


                const address =
                    item.address ||
                    item.alamat ||
                    "-";


                const phone =
                    item.phone ||
                    item.telephone ||
                    "-";


                const npwp =
                    item.npwp ||
                    "-";


                const materialPercent =
                    Math.max(0, Math.min(100, Number(item.material_percent ?? item.materialPercent ?? 0) || 0));

                const labourPercent =
                    100 - materialPercent;


                const notes =
                    item.notes ||
                    item.catatan ||
                    "-";


                const active =
                    Number(
                        item.is_active
                    ) === 1;


                return `
                    <tr>

                        <td>
                            ${index + 1}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(code)}
                            </strong>
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(name)}
                            </strong>
                        </td>

                        <td>
                            ${escapeHtml(alias || "-")}
                        </td>

                        <td>
                            ${escapeHtml(address)}
                        </td>

                        <td>
                            ${escapeHtml(phone)}
                        </td>

                        <td>
                            ${escapeHtml(npwp)}
                        </td>

                        <td>
                            ${materialPercent}% : ${labourPercent}%
                        </td>

                        <td>
                            ${escapeHtml(notes)}
                        </td>

                        <td>

                            <span
                                class="badge ${
                                    active
                                        ? "approved"
                                        : "cancelled"
                                }"
                            >
                                ${
                                    active
                                        ? "Aktif"
                                        : "Tidak Aktif"
                                }
                            </span>

                        </td>

                        <td>

                            <div class="action">

                                <button
                                    type="button"
                                    class="btn-small"
                                    onclick="editAsuransi(${Number(id)})"
                                >
                                    Edit
                                </button>


                            </div>

                        </td>

                    </tr>
                `;

            }
        )
        .join("");

}


// ============================================================
// GENERATE PREVIEW CODE
// ============================================================

function getNextAsuransiCode() {

    let lastNumber = 0;


    asuransiData.forEach(
        function (item) {

            const code =
                String(
                    item.code || ""
                );


            const match =
                code.match(
                    /(\d+)$/
                );


            if (match) {

                const number =
                    parseInt(
                        match[1],
                        10
                    );


                if (
                    number >
                    lastNumber
                ) {

                    lastNumber =
                        number;

                }

            }

        }
    );


    return (
        "INS-" +
        String(
            lastNumber + 1
        ).padStart(
            4,
            "0"
        )
    );

}


// ============================================================
// OPEN FORM
// ============================================================

function openAsuransiForm(
    id = null
) {

    editingAsuransiId =
        id !== null
            ? Number(id)
            : null;


    const modal =
        document.getElementById(
            "asuransiModal"
        );

    const form =
        document.getElementById(
            "asuransiForm"
        );

    const title =
        document.getElementById(
            "asuransiModalTitle"
        );

    const idField =
        document.getElementById(
            "asuransiId"
        );

    const codeField =
        document.getElementById(
            "asuransiCode"
        );

    const nameField =
        document.getElementById(
            "asuransiName"
        );

    const aliasField =
        document.getElementById(
            "asuransiAlias"
        );

    const addressField =
        document.getElementById(
            "asuransiAddress"
        );

    const phoneField =
        document.getElementById(
            "asuransiPhone"
        );

    const npwpField =
        document.getElementById(
            "asuransiNpwp"
        );

    const materialField =
        document.getElementById(
            "asuransiMaterialPercent"
        );

    const labourField =
        document.getElementById(
            "asuransiLabourPercent"
        );

    const notesField =
        document.getElementById(
            "asuransiNotes"
        );

    const statusField =
        document.getElementById(
            "asuransiStatus"
        );

    const messageField =
        document.getElementById(
            "asuransiMessage"
        );


    if (
        !modal ||
        !form
    ) {

        console.error(
            "Modal/Form Asuransi tidak ditemukan."
        );

        return;

    }


    form.reset();

    if (materialField) materialField.value = "0";
    if (labourField) labourField.value = "100";


    if (messageField) {

        messageField.textContent =
            "";

        messageField.className =
            "form-message";

    }


    if (
        editingAsuransiId === null
    ) {

        if (title) {

            title.textContent =
                "Tambah Asuransi";

        }

        if (idField) {

            idField.value =
                "";

        }

        if (codeField) {

            codeField.value =
                getNextAsuransiCode();

        }

        if (statusField) {

            statusField.value =
                "1";

        }

    }

    else {

        const item =
            asuransiData.find(
                function (data) {

                    return Number(
                        data.id
                    ) ===
                    editingAsuransiId;

                }
            );


        if (!item) {

            myWorkshopAlert(
                "Data asuransi tidak ditemukan."
            );

            editingAsuransiId =
                null;

            return;

        }


        if (title) {

            title.textContent =
                "Edit Asuransi";

        }


        if (idField) {

            idField.value =
                item.id;

        }


        if (codeField) {

            codeField.value =
                item.code ||
                "";

        }


        if (nameField) {

            nameField.value =
                item.name ||
                "";

        }

        if (aliasField) {

            aliasField.value =
                item.alias ||
                "";

        }


        if (addressField) {

            addressField.value =
                item.address ||
                "";

        }


        if (phoneField) {

            phoneField.value =
                item.phone ||
                "";

        }

        if (npwpField) {
            npwpField.value = item.npwp || "";
        }

        const editMaterialPercent =
            Math.max(0, Math.min(100, Number(item.material_percent ?? item.materialPercent ?? 0) || 0));

        if (materialField) {
            materialField.value = editMaterialPercent;
        }

        if (labourField) {
            labourField.value = 100 - editMaterialPercent;
        }


        if (notesField) {

            notesField.value =
                item.notes ||
                "";

        }


        if (statusField) {

            statusField.value =
                Number(
                    item.is_active
                ) === 1
                    ? "1"
                    : "0";

        }

    }


    /*
     * Paksa modal tampil.
     * Tidak bergantung hanya pada CSS .show.
     */

    modal.classList.add(
        "show"
    );

    modal.style.display =
        "flex";

    modal.style.visibility =
        "visible";

    modal.style.opacity =
        "1";


    setTimeout(
        function () {

            if (nameField) {

                nameField.focus();

            }

        },
        100
    );

}


// ============================================================
// CLOSE FORM
// ============================================================

function closeAsuransiForm() {

    editingAsuransiId =
        null;


    const modal =
        document.getElementById(
            "asuransiModal"
        );


    if (!modal) {

        return;

    }


    modal.classList.remove(
        "show"
    );

    modal.style.display =
        "none";

    modal.style.visibility =
        "hidden";

    modal.style.opacity =
        "0";

}


// ============================================================
// EDIT
// ============================================================

function editAsuransi(id) {

    openAsuransiForm(
        Number(id)
    );

}


// ============================================================
// SAVE
// ============================================================

async function saveAsuransi(
    event
) {

    event.preventDefault();


    const id =
        document.getElementById(
            "asuransiId"
        )?.value;


    const nameField =
        document.getElementById(
            "asuransiName"
        );


    const name =
        nameField
            ? nameField.value.trim()
            : "";

    const alias =
        document.getElementById(
            "asuransiAlias"
        )?.value.trim() || "";


    if (!name) {

        myWorkshopAlert(
            "Nama Asuransi wajib diisi."
        );

        if (nameField) {

            nameField.focus();

        }

        return;

    }


    const address =
        document.getElementById(
            "asuransiAddress"
        )?.value.trim() || "";


    const phone =
        document.getElementById(
            "asuransiPhone"
        )?.value.trim() || "";

    const npwp =
        document.getElementById(
            "asuransiNpwp"
        )?.value.trim() || "";

    let materialPercent =
        Number(
            document.getElementById(
                "asuransiMaterialPercent"
            )?.value
        );

    if (!Number.isFinite(materialPercent)) {
        materialPercent = 0;
    }

    materialPercent =
        Math.max(0, Math.min(100, materialPercent));

    const labourPercent =
        100 - materialPercent;

    const notes =
        document.getElementById(
            "asuransiNotes"
        )?.value.trim() || "";


    const status =
        document.getElementById(
            "asuransiStatus"
        )?.value === "1";


    const button =
        document.getElementById(
            "btnSimpanAsuransi"
        );


    if (button) {

        button.disabled =
            true;

        button.textContent =
            id
                ? "Menyimpan..."
                : "Menambahkan...";

    }


    try {

        const isEdit =
            Boolean(id);


        const url =
            isEdit
                ? "/api/asuransi/" +
                  encodeURIComponent(id)
                : "/api/asuransi";


        const method =
            isEdit
                ? "PUT"
                : "POST";


        const payload = {

            name:
                name,

            alias:
                alias,

            address:
                address,

            phone:
                phone,

            npwp:
                npwp,

            material_percent:
                materialPercent,

            notes:
                notes,

            is_active:
                status

        };


        const response =
            await fetch(
                url,
                {
                    method:
                        method,

                    headers: {

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"

                    },

                    body:
                        JSON.stringify(
                            payload
                        )

                }
            );


        const text =
            await response.text();


        let result;

        try {

            result =
                JSON.parse(text);

        }

        catch (error) {

            console.error(
                "RESPON SAVE BUKAN JSON:",
                text
            );

            throw new Error(
                "Server tidak mengembalikan JSON. Pastikan route POST/PUT /api/asuransi sudah ada di server.js."
            );

        }


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                result.message ||
                "Gagal menyimpan data asuransi."
            );

        }


        closeAsuransiForm();


        await loadAsuransi();


        showAsuransiSuccessModal(
            isEdit
                ? "Asuransi berhasil diperbarui."
                : "Asuransi berhasil ditambahkan."
        );


    }

    catch (error) {

        console.error(
            "SAVE ASURANSI ERROR:",
            error
        );


        const message =
            document.getElementById(
                "asuransiMessage"
            );


        if (message) {

            message.textContent =
                error.message;

            message.className =
                "form-message error";

        }

        else {

            myWorkshopAlert(
                error.message
            );

        }

    }

    finally {

        if (button) {

            button.disabled =
                false;

            button.textContent =
                "Simpan Asuransi";

        }

    }

}


// ============================================================
// MODAL ASURANSI
// ============================================================

function showAsuransiSuccessModal(message) {
    return window.myWorkshopAlert(message, "success");
}


function showAsuransiDeleteModal(name) {
    return new Promise(resolve => {
        const old = document.getElementById("mwAsuransiDeleteModal");
        if (old) old.remove();
        const modal = document.createElement("div");
        modal.id = "mwAsuransiDeleteModal";
        modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                <div style="background:#fff;width:min(440px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                    <h3 style="margin:0 0 12px;color:#14213d;">Konfirmasi Hapus Asuransi</h3>
                    <p style="margin:0 0 22px;line-height:1.5;">Hapus asuransi <strong>${escapeHtml(name)}</strong>?</p>
                    <div style="display:flex;justify-content:flex-end;gap:10px;">
                        <button type="button" data-cancel style="padding:9px 18px;border:1px solid #2563eb;border-radius:7px;background:#fff;color:#2563eb;font-weight:700;cursor:pointer;">Batal</button>
                        <button type="button" data-ok style="padding:9px 18px;border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;" class="mw-delete-button">Hapus</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const close = value => { modal.remove(); resolve(value); };
        modal.querySelector("[data-cancel]").onclick = () => close(false);
        modal.querySelector("[data-ok]").onclick = () => close(true);
    });
}


// ============================================================
// DELETE
// ============================================================

async function deleteAsuransi(
    id
) {

    const item =
        asuransiData.find(
            function (data) {

                return Number(
                    data.id
                ) ===
                Number(id);

            }
        );


    if (!item) {

        myWorkshopAlert(
            "Data asuransi tidak ditemukan."
        );

        return;

    }


    const name =
        item.name ||
        "Asuransi";


    const confirmed =
        await showAsuransiDeleteModal(name);


    if (!confirmed) {

        return;

    }


    try {

        const response =
            await fetch(
                "/api/asuransi/" +
                encodeURIComponent(id),
                {
                    method:
                        "DELETE",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );


        const text =
            await response.text();


        let result;

        try {

            result =
                JSON.parse(text);

        }

        catch (error) {

            console.error(
                "RESPON DELETE BUKAN JSON:",
                text
            );

            throw new Error(
                "Server tidak mengembalikan JSON. Pastikan route DELETE /api/asuransi/:id sudah ada."
            );

        }


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                result.message ||
                "Data asuransi tidak dapat dihapus."
            );

        }


        await loadAsuransi();


        showAsuransiSuccessModal(
            "Asuransi berhasil dihapus."
        );

    }

    catch (error) {

        console.error(
            "DELETE ASURANSI ERROR:",
            error
        );

        myWorkshopAlert(
            error.message
        );

    }

}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(
    value
) {

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


// ============================================================
// GLOBAL
// ============================================================

window.openAsuransiForm =
    openAsuransiForm;

window.closeAsuransiForm =
    closeAsuransiForm;

window.editAsuransi =
    editAsuransi;

window.deleteAsuransi =
    deleteAsuransi;

window.loadAsuransi =
    loadAsuransi;

window.logout =
    logout;