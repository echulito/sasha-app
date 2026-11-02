# Pruebas de la app

Corren en cada cambio (GitHub Actions) y antes de cada entrega:

    npm test

- `app.test.mjs`: entrada con PIN, que el PIN y la sesión no viajen en la dirección, la huella de ida y vuelta
  ("llegó completo"), que no se usen datos que llegaron incompletos, compatibilidad con ECHU sin actualizar,
  el aviso verde al guardar, todas las pestañas sin errores ni bloqueos de seguridad y el link de cajeras.
- Regresión visual: cada pestaña se compara con `capturas/*.png`. Si un cambio de diseño es a propósito:
  `npm run test:aprobar-capturas` (y revisar las imágenes nuevas antes de subirlas).
- Todos los datos de las pruebas son inventados (`echu-falso.mjs`): este repositorio es público.
