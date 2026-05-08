lucide.createIcons();

    function toggleSenha() {
        const input = document.getElementById('senha');
        const icone = document.getElementById('icone-olho');
        if (input.type === 'password') {
            input.type = 'text';
            icone.setAttribute('data-lucide', 'eye-off');
        } else {
            input.type = 'password';
            icone.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
    }

    async function fazerLogin() {
        const usuario = document.getElementById('usuario').value.trim();
        const senha = document.getElementById('senha').value;
        const erroDiv = document.getElementById('erroLogin');

        if (!usuario || !senha) {
            erroDiv.textContent = "Preencha todos os campos.";
            erroDiv.classList.add('show');
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, senha })
            });
            const data = await res.json();

            if (data.status === 'sucesso') {
                sessionStorage.setItem('erp_token', data.token);
                sessionStorage.setItem('erp_usuario', usuario);
                sessionStorage.setItem('erp_perfil', data.perfil || (usuario === 'admin' ? 'admin' : 'operador'));
                window.location.href = '/admin-erp';
            } else {
                erroDiv.textContent = data.mensagem || "Usuário ou senha incorretos.";
                erroDiv.classList.remove('show');
                void erroDiv.offsetWidth;
                erroDiv.classList.add('show');
            }
        } catch (e) {
            erroDiv.textContent = "Servidor indisponível.";
            erroDiv.classList.add('show');
        }
    }

    document.getElementById('senha').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') fazerLogin();
    });
    document.getElementById('usuario').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('senha').focus();
    });
