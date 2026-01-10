# ⚡ CONFIGURACIÓN RÁPIDA EN VERCEL - 3 PASOS

## ✅ El código está listo y funcionando
Solo necesitas configurar 2 variables de entorno en Vercel y listo.

---

## 🚀 PASO 1: Configurar Variables de Entorno (2 minutos)

1. **Abre Vercel Dashboard:**
   - Ve a: https://vercel.com/dashboard
   - Selecciona tu proyecto

2. **Ve a Environment Variables:**
   - Click en: **Settings** → **Environment Variables**
   - O directamente desde: https://vercel.com/dashboard/[TU-PROYECTO]/settings/environment-variables

3. **Agrega estas 2 variables:**

   **Variable 1:**
   ```
   Key: OPENAI_API_KEY
   Value: sk-tu-clave-completa-de-openai
   Environment: Production, Preview, Development (marca todas)
   ```

   **Variable 2:**
   ```
   Key: ASSISTANT_ID
   Value: asst-tu-id-completo-del-asistente
   Environment: Production, Preview, Development (marca todas)
   ```

   **Opcional (si quieres personalizar):**
   ```
   Key: ALLOWED_ORIGINS
   Value: https://www.argentino.click,https://argentino.click
   Environment: Production, Preview, Development
   ```

---

## 🔄 PASO 2: Hacer Redeploy (30 segundos)

**⚠️ IMPORTANTE:** Después de agregar las variables, DEBES hacer un redeploy:

1. En Vercel Dashboard, ve a **Deployments**
2. Click en el menú de los 3 puntos (⋯) del último deploy
3. Selecciona **"Redeploy"**
4. O simplemente haz un nuevo commit y push a tu repositorio
5. Espera 1-2 minutos que termine el deploy

---

## ✅ PASO 3: Verificar (10 segundos)

1. Abre tu sitio: `https://tu-proyecto.vercel.app`
2. Abre el chat
3. Deberías ver el mensaje de bienvenida
4. Envía un mensaje
5. **¡Debería funcionar!** 🎉

---

## 🐛 Si No Funciona

### Verifica los logs:
- Vercel Dashboard → **Deployments** → Click en el último deploy → **Functions** → **api/assistant**
- Busca si hay errores sobre variables de entorno

### Verifica las variables:
- Settings → Environment Variables
- Asegúrate de que `OPENAI_API_KEY` y `ASSISTANT_ID` están configuradas
- Verifica que estén marcadas para **Production, Preview y Development**
- Verifica que no tengan espacios extras
- Verifica que los nombres sean exactamente: `OPENAI_API_KEY` y `ASSISTANT_ID` (en mayúsculas)

### Si aún no funciona:
1. Elimina las variables
2. Vuelve a agregarlas (asegúrate de marcar todos los ambientes)
3. Haz un redeploy completo
4. Espera 2 minutos
5. Prueba nuevamente

---

## 📝 Checklist Final

- [ ] Variables `OPENAI_API_KEY` configurada en Vercel
- [ ] Variable `ASSISTANT_ID` configurada en Vercel
- [ ] Ambas configuradas para Production, Preview y Development
- [ ] Redeploy realizado después de agregar variables
- [ ] Deploy completado correctamente
- [ ] Chat funciona correctamente
- [ ] Mensaje de bienvenida aparece al abrir el chat

---

## 🎯 Características del Chatbot

✅ **Mensaje de bienvenida** al abrir el chat  
✅ **Diseño profesional** con glassmorphism  
✅ **Responsive** - Full screen en mobile, tamaño optimizado en desktop  
✅ **Manejo de errores** robusto  
✅ **Rate limiting** para prevenir abusos  
✅ **Thread persistence** - Mantiene la conversación  
✅ **Timeout optimizado** - 8 segundos para plan gratuito de Vercel  

---

**El código está 100% funcional y optimizado para Vercel.** Solo necesitas estos 3 pasos simples y funcionará perfectamente. 🚀
