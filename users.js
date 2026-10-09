(function () {
    "use strict";

    const API_USERS = "/api/users";
    const API_ROLES = "/api/roles";

    const body = document.getElementById("usersTableBody");
    const modal = document.getElementById("userModal");
    const form = document.getElementById("userForm");
    const notice = document.getElementById("usersNotice");
    const addButton = document.getElementById("btnAddUser");
    const managerNote = document.getElementById("managerOnlyNote");
    const superAdminWorkshopFilter = document.getElementById("superAdminWorkshopFilter");
    const filterWorkshop = document.getElementById("filterWorkshop");
    const workshopHeader = document.getElementById("workshopHeader");
    const roleSelect = document.getElementById("editRole");
    const targetWorkshopField = document.getElementById("targetWorkshopField");
    const editWorkshop = document.getElementById("editWorkshop");
    const passwordInput = document.getElementById("editPassword");
    const passwordHelp = document.getElementById("passwordHelp");
    const modalTitle = document.getElementById("userModalTitle");
    const modalDescription = document.getElementById("userModalDescription");
    const activeInput = document.getElementById("editActive");
    const deletePasswordPanel = document.getElementById("deletePasswordPanel");
    const deleteEstimatePassword = document.getElementById("deleteEstimatePassword");
    const deleteWOPassword = document.getElementById("deleteWOPassword");
    const saveDeletePasswords = document.getElementById("saveDeletePasswords");
    const paymentBankPanel = document.getElementById("paymentBankPanel");
    const orBankName = document.getElementById("orBankName");
    const orAccountNumber = document.getElementById("orAccountNumber");
    const orAccountName = document.getElementById("orAccountName");
    const kuitansiBankList = document.getElementById("kuitansiBankList");
    const addKuitansiBank = document.getElementById("addKuitansiBank");
    const savePaymentBankSettings = document.getElementById("savePaymentBankSettings");
    let kuitansiBankAccounts = [];

    let users = [];
    let roles = [];
    let managerMaster = false;
    let superAdmin = false;
    let workshops = [];

    const ALLOWED_CREATE_ROLES = ["MANAGER_MASTER", "SERVICE_ADVISOR", "BILLING", "SPAREPART_GUDANG"];

    function esc(value) {
        const d = document.createElement("div");
        d.textContent = String(value ?? "");
        return d.innerHTML;
    }

    function roleCode(role) {
        return String(role?.code || "").trim().toUpperCase();
    }

    function currentUser() {
        try {
            return JSON.parse(localStorage.getItem("myworkshop_user") || "null");
        } catch (_) {
            return null;
        }
    }

    function isSuperAdmin() {
        const user = currentUser();
        const code = String(user?.role?.code || "").toUpperCase().replace(/\s+/g, "_");
        const name = String(user?.role?.name || user?.role || "").toUpperCase().trim();
        return code === "SUPER_ADMIN" || name === "SUPER ADMIN";
    }

    function isManagerMaster() {
        const user = currentUser();
        const code = String(user?.role?.code || "").toUpperCase();
        const name = String(user?.role?.name || user?.role || "").toUpperCase();
        return code === "MANAGER_MASTER" || name === "MANAGER MASTER";
    }

    function showNotice(message, type) {
        notice.textContent = message;
        notice.className = "users-notice show " + (type || "error");
        clearTimeout(showNotice.timer);
        showNotice.timer = setTimeout(function () {
            notice.className = "users-notice";
        }, 4000);
    }

    function titleCase(value) {
        return String(value || "").trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    function allowedRoles() {
        return roles.filter(function (role) {
            return ALLOWED_CREATE_ROLES.includes(roleCode(role));
        });
    }

    function renderRoleOptions(selected, includeManager) {
        // Semua role yang dapat dibuat oleh Manager Master ditampilkan,
        // termasuk Manager Master sendiri.
        const options = allowedRoles();

        roleSelect.innerHTML = options.map(function (role) {
            const code = roleCode(role);
            const selectedAttr = code === String(selected || "").toUpperCase() || String(role.id) === String(selected || "") ? "selected" : "";
            return `<option value="${esc(role.id)}" ${selectedAttr}>${esc(role.name)}</option>`;
        }).join("");

        if (!options.length) {
            roleSelect.innerHTML = `<option value="">Role belum tersedia</option>`;
        }
    }

    function renderUsers() {
        const showWorkshop = superAdmin;
        if (workshopHeader) workshopHeader.style.display = showWorkshop ? "table-cell" : "none";
        const colspan = showWorkshop ? 7 : 6;
        if (!users.length) {
            body.innerHTML = `<tr><td colspan="${colspan}" class="users-empty">Belum ada data user.</td></tr>`;
            return;
        }

        body.innerHTML = users.map(function (u, i) {
            const code = roleCode({ code: u.role_code });
            const canEdit = managerMaster || superAdmin;
            return `
                <tr>
                    <td>${i + 1}</td>
                    <td><div class="user-name">${esc(u.full_name || u.username || "-")}</div></td>
                    <td><div class="user-login">${esc(u.username || "-")}</div></td>
                    <td>
                        <div class="user-role">${esc(u.role_name || u.role_code || "-")}</div>
                        <div class="user-role-desc">${code === "MANAGER_MASTER" ? "Akses seluruh menu" : "Pengguna operasional"}</div>
                    </td>
                    ${showWorkshop ? `<td><div class="user-role">${esc(u.workshop_name || "-")}</div><div class="user-role-desc">${esc(u.workshop_code || "")}</div></td>` : ""}
                    <td>${Number(u.is_active) !== 0 ? '<span class="badge-active">AKTIF</span>' : '<span class="badge-off">NONAKTIF</span>'}</td>
                    <td>
                        ${canEdit ? `<div class="user-actions"><button class="user-btn" type="button" data-action="edit" data-id="${Number(u.id)}">Edit</button></div>` : '<span style="color:#94a3b8;font-size:11px">Hanya Manager Master</span>'}
                    </td>
                </tr>`;
        }).join("");
    }

    async function loadSuperAdminWorkshops() {
        if (!superAdmin || !filterWorkshop) return;
        try {
            const res = await fetch("/api/super-admin/workshops", {
                cache: "no-store",
                headers: { "X-MyWorkshop-User-Id": String(currentUser()?.id || "") }
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal mengambil daftar bengkel.");
            workshops = Array.isArray(json.data) ? json.data : [];
            filterWorkshop.innerHTML = '<option value="">Semua Bengkel</option>' + workshops.map(w => `<option value="${esc(w.id)}">${esc(w.name || w.workshop_code || "Bengkel")}</option>`).join("");
        } catch (error) {
            showNotice(error.message, "error");
        }
    }

    async function saveDeletePasswordSettings() {
        if (!managerMaster) {
            showNotice("Hanya Manager Master yang dapat mengubah Password Hapus.", "error");
            return;
        }
        const estimate_password = String(deleteEstimatePassword?.value || "");
        const wo_password = String(deleteWOPassword?.value || "");
        if (estimate_password.length < 6 || wo_password.length < 6) {
            showNotice("Password Hapus Estimasi dan Hapus WO minimal 6 karakter.", "error");
            return;
        }
        saveDeletePasswords.disabled = true;
        try {
            const res = await fetch("/api/security/delete-passwords", {
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-MyWorkshop-User-Id": String(currentUser()?.id || "") },
                body: JSON.stringify({ estimate_password, wo_password })
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal mengubah Password Hapus.");
            deleteEstimatePassword.value = "";
            deleteWOPassword.value = "";
            showNotice("Password Hapus Estimasi dan Hapus WO berhasil diperbarui.", "success");
        } catch (error) {
            showNotice(error.message, "error");
        } finally {
            saveDeletePasswords.disabled = false;
        }
    }

    function renderKuitansiBankAccounts() {
        if (!kuitansiBankList) return;
        if (!kuitansiBankAccounts.length) {
            kuitansiBankList.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px 0">Belum ada rekening Kuitansi Perbaikan. Tambahkan rekening terlebih dahulu.</div>';
            return;
        }
        kuitansiBankList.innerHTML = kuitansiBankAccounts.map((a, i) => `
            <div class="bank-account-row" data-bank-index="${i}" style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:8px">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end">
                    <div class="user-field"><label>Nama Bank</label><input data-bank-field="bank" value="${esc(a.bank)}" placeholder="BCA"></div>
                    <div class="user-field"><label>Nomor Rekening</label><input data-bank-field="account_number" value="${esc(a.account_number)}" placeholder="Nomor rekening"></div>
                    <div class="user-field"><label>Atas Nama</label><input data-bank-field="account_name" value="${esc(a.account_name)}" placeholder="Nama pemilik rekening"></div>
                    <button type="button" class="user-btn danger mw-delete-button" data-remove-bank="${i}">Hapus</button>
                </div>
            </div>`).join("");
    }

    function readKuitansiBankAccounts() {
        if (!kuitansiBankList) return;
        kuitansiBankList.querySelectorAll(".bank-account-row").forEach((row, i) => {
            const get = field => row.querySelector(`[data-bank-field="${field}"]`)?.value?.trim() || "";
            if (!kuitansiBankAccounts[i]) kuitansiBankAccounts[i] = { id: "" };
            kuitansiBankAccounts[i].bank = get("bank");
            kuitansiBankAccounts[i].account_number = get("account_number");
            kuitansiBankAccounts[i].account_name = get("account_name");
        });
        kuitansiBankAccounts = kuitansiBankAccounts.filter(a => a.bank || a.account_number || a.account_name);
    }

    async function loadPaymentBankSettings() {
        if (!managerMaster || !paymentBankPanel) return;
        try {
            const res = await fetch("/api/settings/payment-bank-accounts", { cache: "no-store", headers: { "X-MyWorkshop-User-Id": String(currentUser()?.id || "") } });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal mengambil rekening pembayaran.");
            const data = json.data || {};
            const or = data.or_account || {};
            orBankName.value = or.bank || "";
            orAccountNumber.value = or.account_number || "";
            orAccountName.value = or.account_name || "";
            kuitansiBankAccounts = Array.isArray(data.kuitansi_accounts) ? data.kuitansi_accounts.map(x => ({...x})) : [];
            renderKuitansiBankAccounts();
        } catch (error) { showNotice(error.message, "error"); }
    }

    async function savePaymentBankSettingsData() {
        if (!managerMaster) return showNotice("Hanya Manager Master yang dapat mengubah rekening pembayaran.", "error");
        readKuitansiBankAccounts();
        savePaymentBankSettings.disabled = true;
        try {
            const payload = { or_account: { bank: orBankName.value.trim(), account_number: orAccountNumber.value.trim(), account_name: orAccountName.value.trim() }, kuitansi_accounts: kuitansiBankAccounts };
            const res = await fetch("/api/settings/payment-bank-accounts", { method:"PUT", headers:{"Content-Type":"application/json","X-MyWorkshop-User-Id":String(currentUser()?.id || "")}, body:JSON.stringify(payload) });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal menyimpan rekening pembayaran.");
            kuitansiBankAccounts = json.data?.kuitansi_accounts || kuitansiBankAccounts;
            renderKuitansiBankAccounts();
            showNotice("Rekening pembayaran berhasil disimpan.", "success");
        } catch (error) { showNotice(error.message, "error"); }
        finally { savePaymentBankSettings.disabled = false; }
    }

    async function loadRoles() {
        const res = await fetch(API_ROLES, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Gagal mengambil data role.");
        roles = Array.isArray(json.data) ? json.data : [];
    }

    async function loadUsers() {
        body.innerHTML = '<tr><td colspan="6" class="users-empty">Memuat data user...</td></tr>';
        try {
            const params = new URLSearchParams();
            if (superAdmin && filterWorkshop?.value) params.set("workshop_id", filterWorkshop.value);
            const url = params.toString() ? `${API_USERS}?${params.toString()}` : API_USERS;
            const res = await fetch(url, { cache: "no-store", headers: { "X-MyWorkshop-User-Id": String(currentUser()?.id || "") } });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal mengambil data user.");
            users = Array.isArray(json.data) ? json.data : [];
            renderUsers();
        } catch (error) {
            body.innerHTML = `<tr><td colspan="6" class="users-empty">${esc(error.message)}</td></tr>`;
        }
    }

    function renderTargetWorkshopOptions(selected) {
        if (!editWorkshop) return;
        editWorkshop.innerHTML = '<option value="">Pilih Bengkel</option>' + workshops.map(function (w) {
            const selectedAttr = String(w.id) === String(selected || "") ? "selected" : "";
            return `<option value="${esc(w.id)}" ${selectedAttr}>${esc(w.name || w.workshop_code || "Bengkel")}</option>`;
        }).join("");
        if (targetWorkshopField) targetWorkshopField.style.display = superAdmin ? "block" : "none";
        editWorkshop.required = !!superAdmin;
    }

    function resetForm() {
        document.getElementById("editUserId").value = "";
        document.getElementById("editFullName").value = "";
        document.getElementById("editUsername").value = "";
        document.getElementById("editPassword").value = "";
        activeInput.checked = true;
        modalTitle.textContent = "Tambah User";
        modalDescription.textContent = "Buat ID login baru untuk pengguna MyWorkshop.";
        passwordInput.required = true;
        document.getElementById("passwordRequiredMark").textContent = "*";
        passwordHelp.textContent = "Password digunakan untuk login pertama kali.";
        renderRoleOptions("", true);
        roleSelect.disabled = false;
        renderTargetWorkshopOptions("");
    }

    function openAddModal() {
        if (!managerMaster && !superAdmin) {
            showNotice("Hanya Manager Master atau Super Admin yang dapat membuat user baru.", "error");
            return;
        }
        resetForm();
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        document.getElementById("editFullName").focus();
    }

    function openEditModal(user) {
        resetForm();
        document.getElementById("editUserId").value = user.id;
        document.getElementById("editFullName").value = user.full_name || user.username || "";
        document.getElementById("editUsername").value = user.username || "";
        document.getElementById("editPassword").value = "";
        renderTargetWorkshopOptions(user.workshop_id || "");
        activeInput.checked = Number(user.is_active) !== 0;
        const editingManager = roleCode({ code: user.role_code }) === "MANAGER_MASTER";
        renderRoleOptions(user.role_code || user.role_id, true);
        roleSelect.disabled = false;
        modalTitle.textContent = "Edit User";
        modalDescription.textContent = "Perbarui data login, role, atau status user.";
        passwordInput.required = false;
        document.getElementById("passwordRequiredMark").textContent = "";
        passwordHelp.textContent = "Kosongkan jika password tidak ingin diubah.";
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        document.getElementById("editFullName").focus();
    }

    function closeModal() {
        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");
    }

    async function saveUser(event) {
        event.preventDefault();
        if (!managerMaster && !superAdmin) {
            showNotice("Hanya Manager Master atau Super Admin yang dapat mengubah user.", "error");
            return;
        }

        const id = document.getElementById("editUserId").value.trim();
        const full_name = titleCase(document.getElementById("editFullName").value);
        const username = document.getElementById("editUsername").value.trim();
        const role_id = roleSelect.value;
        const password = passwordInput.value;
        const is_active = activeInput.checked ? 1 : 0;
        const workshop_id = superAdmin ? String(editWorkshop?.value || "") : "";

        if (!full_name || !username || !role_id) {
            showNotice("Nama User, Username, dan Role wajib diisi.", "error");
            return;
        }
        if (!id && password.length < 6) {
            showNotice("Password user baru minimal 6 karakter.", "error");
            return;
        }
        if (id && password && password.length < 6) {
            showNotice("Password baru minimal 6 karakter.", "error");
            return;
        }
        if (superAdmin && !workshop_id) {
            showNotice("Tujuan Bengkel wajib dipilih untuk user baru.", "error");
            return;
        }

        const payload = { full_name, username, is_active, current_user_id: currentUser()?.id || null };
        if (!roleSelect.disabled) payload.role_id = role_id;
        if (superAdmin && workshop_id) payload.workshop_id = Number(workshop_id);
        if (password) payload.password = password;

        try {
            const res = await fetch(id ? `${API_USERS}/${encodeURIComponent(id)}` : API_USERS, {
                method: id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", "X-MyWorkshop-User-Id": String(currentUser()?.id || "") },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Gagal menyimpan user.");

            const saved = json.data;
            const current = currentUser();
            if (current && Number(current.id) === Number(saved.id)) {
                current.username = saved.username;
                current.full_name = saved.full_name;
                if (saved.role_id && saved.role_code) {
                    current.role = { id: saved.role_id, code: saved.role_code, name: saved.role_name };
                }
                localStorage.setItem("myworkshop_user", JSON.stringify(current));
            }

            closeModal();
            showNotice(id ? "Data user berhasil diperbarui." : "User baru berhasil dibuat.", "success");
            await loadUsers();
        } catch (error) {
            showNotice(error.message, "error");
        }
    }

    if (filterWorkshop) filterWorkshop.addEventListener("change", loadUsers);

    async function init() {
        managerMaster = isManagerMaster();
        superAdmin = isSuperAdmin();

        if (superAdmin) {
            addButton.style.display = "inline-flex";
            managerNote.style.display = "block";
            managerNote.textContent = "Anda login sebagai Super Admin. Anda dapat membuat user dan menentukan tujuan bengkelnya.";
            if (superAdminWorkshopFilter) superAdminWorkshopFilter.style.display = "flex";
            if (deletePasswordPanel) deletePasswordPanel.style.display = "none";
            if (paymentBankPanel) paymentBankPanel.style.display = "none";
            await loadSuperAdminWorkshops();
        } else if (managerMaster) {
            addButton.style.display = "inline-flex";
            managerNote.style.display = "block";
            managerNote.textContent = "Anda login sebagai Manager Master. Anda dapat membuat ID User Manager Master, Service Advisor, Billing, dan Sparepart / Gudang serta mengatur Password Penghapusan.";
            if (deletePasswordPanel) deletePasswordPanel.style.display = "block";
            if (paymentBankPanel) paymentBankPanel.style.display = "block";
        } else {
            addButton.style.display = "none";
            managerNote.style.display = "block";
            managerNote.textContent = "Halaman ini hanya dapat dikelola oleh Manager Master. Anda hanya dapat melihat daftar user.";
        }

        try {
            await loadPaymentBankSettings();
            await loadRoles();
            renderRoleOptions("", true);
            await loadUsers();
        } catch (error) {
            showNotice(error.message, "error");
            await loadUsers();
        }
    }

    addButton.addEventListener("click", openAddModal);
    document.getElementById("cancelUserEdit").addEventListener("click", closeModal);
    document.getElementById("closeUserModal").addEventListener("click", closeModal);
    modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && modal.classList.contains("show")) closeModal();
    });
    body.addEventListener("click", function (event) {
        const button = event.target.closest('[data-action="edit"]');
        if (!button) return;
        const user = users.find(function (item) { return Number(item.id) === Number(button.dataset.id); });
        if (user) openEditModal(user);
    });
    form.addEventListener("submit", saveUser);
    saveDeletePasswords?.addEventListener("click", saveDeletePasswordSettings);
    savePaymentBankSettings?.addEventListener("click", savePaymentBankSettingsData);
    addKuitansiBank?.addEventListener("click", function () {
        readKuitansiBankAccounts();
        kuitansiBankAccounts.push({ id:"", bank:"", account_number:"", account_name:"" });
        renderKuitansiBankAccounts();
    });
    kuitansiBankList?.addEventListener("click", function (event) {
        const btn = event.target.closest("[data-remove-bank]");
        if (!btn) return;
        readKuitansiBankAccounts();
        kuitansiBankAccounts.splice(Number(btn.dataset.removeBank), 1);
        renderKuitansiBankAccounts();
    });

    init();
})();
