# EFT SIP Mobile M7.5.5

Исправление обновлений GitHub Pages / iPhone PWA:

- новый Service Worker cache key `eft-sip-mobile-m7-5-5`;
- HTML, JS и CSS всегда загружаются network-first с `cache: no-store`;
- старые Cache Storage автоматически удаляются при активации нового Service Worker;
- регистрация Service Worker выполняется с `updateViaCache: none`;
- при запуске приложение принудительно вызывает `registration.update()`;
- при смене контролирующего Service Worker страница автоматически перезагружается;
- пока приложение открыто, обновление проверяется раз в минуту;
- индикатор редактора плана обновлён до `M7.5.5`.

Это сделано специально для частых тестовых релизов через GitHub Pages и установленного приложения на iPhone.
