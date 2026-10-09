// ==========================================
// MYWORKSHOP - LOGIN
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    const loginForm = document.getElementById("loginForm");
    const loginButton = document.getElementById("loginButton");
    const message = document.getElementById("message");

    if (!loginForm) {
        return;
    }

    loginForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;

        // ==========================================
        // VALIDASI
        // ==========================================

        if (!username || !password) {

            message.textContent =
                "Username dan password wajib diisi.";

            return;
        }

        // ==========================================
        // TOMBOL LOGIN
        // ==========================================

        loginButton.disabled = true;
        loginButton.textContent = "MEMPROSES...";

        message.textContent = "";

        try {

            // ==========================================
            // KIRIM KE SERVER
            // ==========================================

            const response = await fetch("/api/login", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    username: username,
                    password: password
                })

            });

            const result =
                await response.json();

            // ==========================================
            // LOGIN GAGAL
            // ==========================================

            if (!response.ok || !result.success) {

                message.textContent =
                    result.message ||
                    "Username atau password salah.";

                loginButton.disabled = false;
                loginButton.textContent = "LOGIN";

                return;
            }

            // ==========================================
            // LOGIN BERHASIL
            // ==========================================

            localStorage.setItem(
                "myworkshop_user",
                JSON.stringify(result.user)
            );

            message.textContent =
                "Login berhasil. Membuka Dashboard...";

            // ==========================================
            // MASUK DASHBOARD
            // ==========================================

            setTimeout(() => {

                window.location.href =
                    "/dashboard.html";

            }, 300);

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            message.textContent =
                "Tidak dapat terhubung ke server MyWorkshop.";

            loginButton.disabled = false;
            loginButton.textContent = "LOGIN";

        }

    });

});