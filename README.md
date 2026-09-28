# GarBa Expediente Cliente

Portal web para captura de datos y documentos de clientes en procesos de contratación y servicio.

## Estado actual

Primera versión funcional del frontend:

- formulario por pasos;
- captura de nombre, profesión, correo y teléfono;
- beneficiarios dinámicos con validación de porcentajes al 100%;
- carga de INE frente, INE reverso y comprobante de domicilio;
- selección del documento que coincide con el domicilio actual;
- validaciones obligatorias visibles en rojo;
- revisión final antes de enviar;
- diseño responsive pensado para celular.

## Importante

El repositorio es público y solo contiene el frontend. **No deben guardarse aquí documentos, datos personales, llaves, secretos ni credenciales.**

El envío seguro todavía está en modo demo. Falta conectar un backend privado que se encargue de:

1. recibir los datos y archivos;
2. resguardar los documentos en almacenamiento privado;
3. generar un PDF con el resumen, INE frente/reverso y comprobante;
4. enviar el expediente por correo a Christian;
5. opcionalmente extraer datos del INE/comprobante para sugerir el domicilio al cliente.

La configuración visible del frontend está en `config.js`. No colocar secretos ahí.
