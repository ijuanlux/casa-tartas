# 🎂 La Casa de las Tartas — Caja diaria

Web sencilla para que la contabilidad diaria de la tienda se meta desde el móvil/PC en vez de en papel. Sustituye los talonarios "Oporto" (fecha, facturas, tarjetas, efectivo, total caja).

**Stack:** HTML + JS vanilla + Supabase (Postgres + Auth) → desplegado en Netlify.

---

## 1. Crear el proyecto Supabase

1. Entra a https://supabase.com, crea una cuenta y un proyecto nuevo (free tier). Anota la **región** más cercana (eu-west-2 / eu-central-1).
2. En el dashboard del proyecto, ve a **Settings → API** y copia:
   - `Project URL`
   - `anon public` key
3. Ve a **SQL Editor → New query**, pega entero el contenido de `supabase-schema.sql` y dale a **Run**. Esto crea las tablas, RLS y el local "Oporto".
4. Ve a **Authentication → Providers → Email** y desactiva "Confirm email" (te ahorras configurar SMTP — para una app interna no hace falta).
5. Ve a **Authentication → Users → Add user → Create new user** y crea:
   - **Tu cuenta** (email tuyo, contraseña) — la pondremos como admin.
   - **La cuenta de la tía** (su email, contraseña inicial) — quedará como usuario normal.
6. Vuelve a **SQL Editor** y ejecuta esto para hacerte admin (cambia el email):
   ```sql
   update profiles set role = 'admin'
   where id = (select id from auth.users where email = 'tu-email@ejemplo.com');
   ```

---

## 2. Probar en local

1. Edita `config.js` y mete tus `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
2. Sirve la carpeta con cualquier servidor estático. Lo más rápido:
   ```bash
   cd ~/Projects/casa-tartas
   python3 -m http.server 8000
   ```
   Y abre http://localhost:8000

3. Entra con tu cuenta admin. Verás la pestaña **Admin** donde puedes:
   - Añadir más locales.
   - Cambiar el rol de tu tía si hiciera falta.

---

## 3. Desplegar a Netlify

Igual que kratos-site:

```bash
cd ~/Projects/casa-tartas
netlify init        # solo la primera vez: crear proyecto en Netlify
netlify deploy --prod
```

Te dará una URL pública (`*.netlify.app`). Pásasela a tu tía con su email y contraseña y listo.

> ⚠ La `anon key` de Supabase es **pública por diseño**: va siempre en el cliente. La seguridad real la imponen las políticas RLS de Postgres (ya están aplicadas en el schema).

---

## 4. Estructura del proyecto

```
casa-tartas/
├── index.html             # SPA: login + app
├── style.css              # Tema cálido, mobile-first
├── app.js                 # Lógica: auth, cierres, histórico, admin
├── config.js              # SUPABASE_URL + anon key (rellénalo)
├── supabase-schema.sql    # Schema completo para Supabase
├── netlify.toml           # Config deploy Netlify
└── README.md
```

---

## 5. Modelo de datos

- **profiles** — perfil de cada usuario (`role`: `admin` | `usuario`)
- **locales** — tiendas (Oporto, etc.)
- **cierres** — un cierre de caja diario por local
- **facturas** — líneas de facturas dentro de un cierre

`tot_caja` se calcula automáticamente (tarjetas + efectivo) a nivel de base de datos.

---

## 6. Funcionalidades

**Tu tía (rol `usuario`):**
- Login con email/contraseña.
- "Nuevo cierre": fecha, local, lista de facturas (con +/-), tarjetas, efectivo. Le aparece un aviso si caja y facturas no cuadran.
- Ver histórico (todos los cierres) con filtros por fecha y local.

**Tú (rol `admin`):** todo lo anterior +
- Pestaña Admin: añadir/desactivar locales, cambiar roles de usuarios.
- Eliminar cierres antiguos.
- Exportar CSV del histórico filtrado.

---

## 7. Mejoras posibles (para más adelante)

- Subir foto del talonario original (Supabase Storage) y adjuntarla al cierre.
- Vista mensual con gráficas (Chart.js).
- PWA: añadir manifest para que se instale como app en el móvil.
- Recordatorio diario por email/WhatsApp.
