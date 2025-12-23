/* Banner de Cookies GDPR - Lógica JavaScript */
(function() {
    'use strict';

    const COOKIE_NAME = 'gdpr_consent';
    const COOKIE_EXPIRY_DAYS = 365;

    // Verificar si ya hay consentimiento
    function hasConsent() {
        return document.cookie.split(';').some(item => item.trim().startsWith(COOKIE_NAME + '='));
    }

    // Guardar consentimiento
    function saveConsent(accepted) {
        const date = new Date();
        date.setTime(date.getTime() + (COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
        const expires = 'expires=' + date.toUTCString();
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = COOKIE_NAME + '=' + (accepted ? 'true' : 'false') + '; ' + expires + '; path=/; SameSite=Lax' + secure;
    }

    // Mostrar banner
    function showBanner() {
        // Crear HTML del banner
        const banner = document.createElement('div');
        banner.className = 'gdpr-banner';
        banner.innerHTML = `
            <div class="gdpr-banner-content">
                <div class="gdpr-banner-text">
                    <h3>🍪 Uso de Cookies</h3>
                    <p>
                        Utilizamos únicamente <strong>cookies técnicas necesarias</strong> para el funcionamiento de la aplicación
                        (sesión y autenticación). No usamos cookies de terceros ni publicitarias.
                        <a href="/politica-privacidad.html" target="_blank">Más información</a>
                    </p>
                </div>
                <div class="gdpr-banner-buttons">
                    <button class="gdpr-btn gdpr-btn-accept" id="gdprAccept">
                        ✓ Aceptar
                    </button>
                    <button class="gdpr-btn gdpr-btn-reject" id="gdprReject">
                        ✕ Rechazar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // Mostrar con animación
        setTimeout(() => banner.classList.add('show'), 100);

        // Event listeners
        document.getElementById('gdprAccept').addEventListener('click', () => {
            saveConsent(true);
            hideBanner(banner);
        });

        document.getElementById('gdprReject').addEventListener('click', () => {
            saveConsent(false);
            hideBanner(banner);
            // Opcionalmente, mostrar mensaje de que ciertas funciones pueden no estar disponibles
            console.log('Cookies rechazadas. Algunas funciones pueden no estar disponibles.');
        });
    }

    // Ocultar banner
    function hideBanner(banner) {
        banner.classList.remove('show');
        setTimeout(() => banner.remove(), 300);
    }

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // No mostrar banner en la página de política de privacidad
        if (window.location.pathname.includes('politica-privacidad.html')) {
            return;
        }

        // Si no hay consentimiento, mostrar banner después de 1 segundo
        if (!hasConsent()) {
            setTimeout(showBanner, 1000);
        }
    }

    // Función global para verificar consentimiento (para usar en la app)
    window.gdprHasConsent = hasConsent;

})();
