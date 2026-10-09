// =========================================================
// MYWORKSHOP - CUSTOMER
// =========================================================


let customers = [];


// =========================================================
// START
// =========================================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        initCustomerPage();

    }
);


// =========================================================
// INITIALIZE
// =========================================================

async function initCustomerPage() {

    loadUserInfo();

    setupCustomerEvents();

    await loadCustomers();

}


// =========================================================
// USER INFO
// =========================================================

function loadUserInfo() {

    try {

        const userData =
            localStorage.getItem(
                "myworkshop_user"
            );


        if (!userData) {

            window.location.href =
                "/";

            return;

        }


        const user =
            JSON.parse(userData);


        const fullName =
            user.full_name ||
            user.username ||
            "User";


        const roleName =
            user.role &&
            user.role.name
                ? user.role.name
                : "User";


        const sidebarUser =
            document.getElementById(
                "sidebarUser"
            );


        const sidebarRole =
            document.getElementById(
                "sidebarRole"
            );


        const topAvatar =
            document.getElementById(
                "topAvatar"
            );


        if (sidebarUser) {

            sidebarUser.textContent =
                fullName;

        }


        if (sidebarRole) {

            sidebarRole.textContent =
                roleName;

        }


        if (topAvatar) {

            topAvatar.textContent =
                getInitials(fullName);

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

        window.location.href =
            "/";

    }

}


// =========================================================
// INITIAL
// =========================================================

function getInitials(name) {

    const words =
        String(name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);


    if (words.length === 0) {

        return "US";

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


// =========================================================
// EVENTS
// =========================================================

function setupCustomerEvents() {

    const btnTambah =
        document.getElementById(
            "btnTambahCustomer"
        );


    const btnClose =
        document.getElementById(
            "btnCloseCustomer"
        );


    const btnBatal =
        document.getElementById(
            "btnBatalCustomer"
        );


    const form =
        document.getElementById(
            "customerForm"
        );


    const search =
        document.getElementById(
            "searchCustomer"
        );


    if (btnTambah) {

        btnTambah.addEventListener(
            "click",
            openCustomerForm
        );

    }


    if (btnClose) {

        btnClose.addEventListener(
            "click",
            closeCustomerForm
        );

    }


    if (btnBatal) {

        btnBatal.addEventListener(
            "click",
            closeCustomerForm
        );

    }


    if (form) {

        form.addEventListener(
            "submit",
            saveCustomer
        );

    }


    if (search) {

        search.addEventListener(
            "input",
            renderCustomers
        );

    }


   
    const btnDownloadExcel =
        document.getElementById(
            "btnDownloadCustomerExcel"
        );


    if (btnDownloadExcel) {

        btnDownloadExcel.addEventListener(
            "click",
            downloadCustomerExcel
        );

    }


    const btnDownloadPdf =
        document.getElementById(
            "btnDownloadCustomerPdf"
        );


    if (btnDownloadPdf) {

        btnDownloadPdf.addEventListener(
            "click",
            downloadCustomerPdf
        );

    }

 const modal =
        document.getElementById(
            "customerModal"
        );


    if (modal) {

        modal.addEventListener(
            "click",
            function (event) {

                if (
                    event.target === modal
                ) {

                    closeCustomerForm();

                }

            }
        );

    }

}


// =========================================================
// LOAD CUSTOMERS
// =========================================================

async function loadCustomers() {

    const tbody =
        document.getElementById(
            "customerTableBody"
        );


    if (tbody) {

        tbody.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    class="empty"
                >
                    Memuat data customer...
                </td>

            </tr>

        `;

    }


    try {

        const response =
            await fetch(
                "/api/customers"
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Gagal mengambil data customer."
            );

        }


        if (!result.success) {

            throw new Error(
                result.message ||
                "Gagal mengambil data customer."
            );

        }


        customers =
            Array.isArray(result.data)
                ? result.data
                : [];


        renderCustomers();

    }

    catch (error) {

        console.error(
            "LOAD CUSTOMER ERROR:",
            error
        );


        if (tbody) {

            tbody.innerHTML = `

                <tr>

                    <td
                        colspan="7"
                        class="empty"
                    >
                        Gagal mengambil data customer.
                        <br><br>
                        ${escapeHtml(
                            error.message
                        )}
                    </td>

                </tr>

            `;

        }

    }

}


// =========================================================
// OPEN FORM
// =========================================================

function openCustomerForm() {

    const form =
        document.getElementById(
            "customerForm"
        );


    const modal =
        document.getElementById(
            "customerModal"
        );


    const title =
        document.getElementById(
            "customerModalTitle"
        );


    const message =
        document.getElementById(
            "customerMessage"
        );


    const id =
        document.getElementById(
            "customerId"
        );


    const code =
        document.getElementById(
            "customerCode"
        );


    if (!form || !modal) {

        console.error(
            "Form customer tidak ditemukan."
        );

        return;

    }


    form.reset();


    id.value = "";


    code.value =
        getNextCustomerCode();


    title.textContent =
        "Tambah Customer";


    message.textContent =
        "";


    message.className =
        "form-message";


    modal.classList.add(
        "show"
    );


    setTimeout(
        function () {

            const name =
                document.getElementById(
                    "customerName"
                );


            if (name) {

                name.focus();

            }

        },
        100
    );

}


// =========================================================
// GENERATE CUSTOMER CODE PREVIEW
// =========================================================

function getNextCustomerCode() {

    let maxNumber = 0;


    customers.forEach(
        customer => {

            const code =
                String(
                    customer.customer_code ||
                    ""
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
                    number > maxNumber
                ) {

                    maxNumber =
                        number;

                }

            }

        }
    );


    return (
        "CUS-" +
        String(
            maxNumber + 1
        ).padStart(
            4,
            "0"
        )
    );

}


// =========================================================
// CLOSE FORM
// =========================================================

function closeCustomerForm() {

    const modal =
        document.getElementById(
            "customerModal"
        );


    if (!modal) {

        return;

    }


    modal.classList.remove(
        "show"
    );

}


// =========================================================
// SAVE CUSTOMER
// =========================================================

async function saveCustomer(event) {

    event.preventDefault();


    const id =
        document.getElementById(
            "customerId"
        ).value;


    const name =
        document.getElementById(
            "customerName"
        ).value.trim();


    const address =
        document.getElementById(
            "customerAddress"
        ).value.trim();


    const phone =
        document.getElementById(
            "customerPhone"
        ).value.trim();


    const notes =
        document.getElementById(
            "customerNotes"
        ).value.trim();


    const message =
        document.getElementById(
            "customerMessage"
        );


    const button =
        document.getElementById(
            "btnSimpanCustomer"
        );


    // -----------------------------------------
    // VALIDASI
    // -----------------------------------------

    if (!name) {

        showCustomerMessage(
            "Nama customer wajib diisi.",
            "error"
        );

        return;

    }


    if (!address) {

        showCustomerMessage(
            "Alamat customer wajib diisi.",
            "error"
        );

        return;

    }


    if (!phone) {

        showCustomerMessage(
            "No. HP customer wajib diisi.",
            "error"
        );

        return;

    }


    // -----------------------------------------
    // DISABLE BUTTON
    // -----------------------------------------

    button.disabled = true;

    button.textContent =
        id
            ? "MENYIMPAN..."
            : "MENAMBAHKAN...";


    message.textContent = "";


    try {

        const payload = {

            name:
                name,

            address:
                address,

            phone:
                phone,

            notes:
                notes

        };


        let response;


        if (id) {

            response =
                await fetch(
                    `/api/customers/${id}`,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

        }

        else {

            response =
                await fetch(
                    "/api/customers",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

        }


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Gagal menyimpan customer."
            );

        }


        if (!result.success) {

            throw new Error(
                result.message ||
                "Gagal menyimpan customer."
            );

        }


        // -------------------------------------
        // BERHASIL
        // -------------------------------------

        closeCustomerForm();


        await loadCustomers();


        showCustomerSuccessModal(
            id
                ? "Customer berhasil diperbarui."
                : "Customer berhasil ditambahkan."
        );

    }

    catch (error) {

        console.error(
            "SAVE CUSTOMER ERROR:",
            error
        );


        showCustomerMessage(
            error.message ||
            "Gagal menyimpan customer.",
            "error"
        );

    }

    finally {

        button.disabled = false;

        button.textContent =
            "Simpan Customer";

    }

}


// =========================================================
// MESSAGE
// =========================================================

function showCustomerMessage(
    text,
    type = "error"
) {

    const message =
        document.getElementById(
            "customerMessage"
        );


    if (!message) {

        return;

    }


    message.textContent =
        text;


    message.className =
        "form-message " +
        type;

}


// =========================================================
// RENDER
// =========================================================

function renderCustomers() {

    const tbody =
        document.getElementById(
            "customerTableBody"
        );


    if (!tbody) {

        return;

    }


    const searchElement =
        document.getElementById(
            "searchCustomer"
        );


    const search =
        searchElement
            ? searchElement.value
                .toLowerCase()
                .trim()
            : "";


    const filtered =
        customers.filter(
            customer => {

                return (

                    String(
                        customer.customer_code ||
                        ""
                    )
                    .toLowerCase()
                    .includes(search)

                    ||

                    String(
                        customer.name ||
                        ""
                    )
                    .toLowerCase()
                    .includes(search)

                    ||

                    String(
                        customer.phone ||
                        ""
                    )
                    .toLowerCase()
                    .includes(search)

                    ||

                    String(
                        customer.address ||
                        ""
                    )
                    .toLowerCase()
                    .includes(search)

                );

            }
        );


    if (
        filtered.length === 0
    ) {

        tbody.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    class="empty"
                >

                    Belum ada customer.

                    <br><br>

                    Klik
                    <strong>
                        "+ Tambah Customer"
                    </strong>
                    untuk menambahkan customer.

                </td>

            </tr>

        `;

        return;

    }


    tbody.innerHTML =
        filtered
            .map(
                (customer, index) => {

                    return `

                        <tr>

                            <td>
                                ${index + 1}
                            </td>


                            <td>

                                <strong>
                                    ${escapeHtml(
                                        customer.customer_code
                                    )}
                                </strong>

                            </td>


                            <td>

                                <strong>
                                    ${escapeHtml(
                                        customer.name
                                    )}
                                </strong>

                            </td>


                            <td>
                                ${escapeHtml(
                                    customer.address ||
                                    "-"
                                )}
                            </td>


                            <td>
                                ${escapeHtml(
                                    customer.phone ||
                                    "-"
                                )}
                            </td>


                            <td>
                                ${escapeHtml(
                                    customer.notes ||
                                    "-"
                                )}
                            </td>


                            <td>

                                <div class="action">

                                    <button
                                        type="button"
                                        class="btn-small"
                                        onclick="editCustomer(${customer.id})"
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


// =========================================================
// DOWNLOAD CUSTOMER
// =========================================================

function downloadCustomerFile(url, fallbackName) {

    return fetch(url)
        .then(async response => {

            if (!response.ok) {

                let message =
                    "Gagal mengunduh data customer.";

                try {

                    const result =
                        await response.json();

                    message =
                        result.message ||
                        message;

                }

                catch (error) {}

                throw new Error(message);

            }

            const blob =
                await response.blob();

            const disposition =
                response.headers.get(
                    "Content-Disposition"
                ) || "";

            const match =
                disposition.match(
                    /filename\*?=(?:UTF-8''|")?([^";]+)"?/i
                );

            const filename =
                match
                    ? decodeURIComponent(match[1])
                    : fallbackName;

            const objectUrl =
                URL.createObjectURL(blob);

            const link =
                document.createElement("a");

            link.href =
                objectUrl;

            link.download =
                filename;

            document.body.appendChild(link);

            link.click();

            link.remove();

            setTimeout(
                () => URL.revokeObjectURL(objectUrl),
                1000
            );

        });

}


async function downloadCustomerExcel() {

    const button =
        document.getElementById(
            "btnDownloadCustomerExcel"
        );

    if (button) {

        button.disabled = true;

        button.textContent =
            "Menyiapkan...";

    }

    try {

        await downloadCustomerFile(
            "/api/customers/export/excel",
            "Data-Customer.xls"
        );

    }

    catch (error) {

        console.error(
            "DOWNLOAD CUSTOMER EXCEL ERROR:",
            error
        );

        myWorkshopAlert(
            error.message ||
            "Gagal mengunduh data customer dalam Excel."
        );

    }

    finally {

        if (button) {

            button.disabled = false;

            button.textContent =
                "Download Excel";

        }

    }

}


async function downloadCustomerPdf() {

    const button =
        document.getElementById(
            "btnDownloadCustomerPdf"
        );

    if (button) {

        button.disabled = true;

        button.textContent =
            "Menyiapkan...";

    }

    try {

        await downloadCustomerFile(
            "/api/customers/export/pdf",
            "Data-Customer.pdf"
        );

    }

    catch (error) {

        console.error(
            "DOWNLOAD CUSTOMER PDF ERROR:",
            error
        );

        myWorkshopAlert(
            error.message ||
            "Gagal mengunduh data customer dalam PDF."
        );

    }

    finally {

        if (button) {

            button.disabled = false;

            button.textContent =
                "Download PDF";

        }

    }

}


// =========================================================
// EDIT CUSTOMER
// =========================================================

function editCustomer(id) {

    const customer =
        customers.find(
            item =>
                String(item.id) ===
                String(id)
        );


    if (!customer) {

        myWorkshopAlert(
            "Customer tidak ditemukan."
        );

        return;

    }


    document.getElementById(
        "customerId"
    ).value =
        customer.id;


    document.getElementById(
        "customerCode"
    ).value =
        customer.customer_code || "";


    document.getElementById(
        "customerName"
    ).value =
        customer.name || "";


    document.getElementById(
        "customerAddress"
    ).value =
        customer.address || "";


    document.getElementById(
        "customerPhone"
    ).value =
        customer.phone || "";


    document.getElementById(
        "customerNotes"
    ).value =
        customer.notes || "";


    document.getElementById(
        "customerModalTitle"
    ).textContent =
        "Edit Customer";


    document.getElementById(
        "customerMessage"
    ).textContent =
        "";


    document.getElementById(
        "customerModal"
    ).classList.add(
        "show"
    );

}


// =========================================================
// MODAL SUKSES CUSTOMER
// =========================================================

function showCustomerSuccessModal(message) {
    return window.myWorkshopAlert(message, "success");
}


// =========================================================
// DELETE CUSTOMER
// =========================================================

function showCustomerDeleteModal(customer) {
    return new Promise(resolve => {
        const old = document.getElementById("mwCustomerDeleteModal");
        if (old) old.remove();
        const modal = document.createElement("div");
        modal.id = "mwCustomerDeleteModal";
        modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;">
                <div style="background:#fff;width:min(440px,100%);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;">
                    <h3 style="margin:0 0 12px;color:#14213d;">Konfirmasi Hapus Customer</h3>
                    <p style="margin:0 0 22px;line-height:1.5;">Hapus customer <strong>${escapeHtml(customer?.name || "-")}</strong>?<br>Data yang sudah dihapus tidak dapat dikembalikan.</p>
                    <div style="display:flex;justify-content:flex-end;gap:10px;">
                        <button type="button" data-cancel style="padding:9px 18px;border:1px solid #2563eb;border-radius:7px;background:#fff;color:#2563eb;font-weight:700;cursor:pointer;">Batal</button>
                        <button type="button" data-ok style="padding:9px 18px;border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;" class="mw-delete-button">Hapus</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const close = value => { modal.remove(); resolve(value); };
        modal.querySelector('[data-cancel]').onclick = () => close(false);
        modal.querySelector('[data-ok]').onclick = () => close(true);
    });
}

async function deleteCustomer(id) {
    const customer = customers.find(item => String(item.id) === String(id));
    if (!customer) return;
    const confirmed = await showCustomerDeleteModal(customer);
    if (!confirmed) return;
    try {
        const response = await fetch(`/api/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.message || "Gagal menghapus customer.");
        await loadCustomers();
        showCustomerMessage?.("Customer berhasil dihapus.", "success");
    } catch (error) {
        console.error("DELETE CUSTOMER ERROR:", error);
        showCustomerMessage?.(error.message || "Gagal menghapus customer.", "error");
    }
}

// =========================================================
// ESCAPE HTML
// =========================================================

function escapeHtml(value) {

    return String(
        value == null
            ? ""
            : value
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