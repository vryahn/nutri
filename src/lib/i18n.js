import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { subscribeBands, getActiveBands, setActiveBands } from './domain.js';

// El string en español ES la clave — así una traducción faltante cae al
// español (nunca rompe, nunca muestra "undefined"). Interpolación: la clave
// lleva el marcador literal %n / %s y el caller hace .replace() tras t().
const EN = {
  // Medidas corporales (Body.jsx) + tab
  Medidas: 'Body',
  'Medidas del día': "Today's measurements",
  'Más medidas ▾': 'More measurements ▾',
  'Menos medidas ▴': 'Fewer measurements ▴',
  Nota: 'Note',
  'Contexto del día (opcional)': 'Day context (optional)',
  'Registra esta medida en 2+ días para ver su tendencia.': 'Log this measurement on 2+ days to see its trend.',
  'Valor fuera de rango — revísalo': 'Out-of-range value — double-check it',
  'Medida a graficar': 'Measurement to chart',
  'Fotos de progreso': 'Progress photos',
  'Añadir fotos': 'Add photos',
  'Subiendo…': 'Uploading…',
  'Foto de progreso': 'Progress photo',
  'Eliminar foto': 'Delete photo',
  Composición: 'Composition',
  Circunferencias: 'Circumferences',
  Peso: 'Weight',
  'Grasa corporal': 'Body fat',
  'Masa muscular': 'Muscle mass',
  'Agua corporal': 'Body water',
  'Masa ósea': 'Bone mass',
  'Grasa visceral': 'Visceral fat',
  'Metabolismo basal': 'Basal metabolism',
  Cintura: 'Waist',
  Cadera: 'Hip',
  Pecho: 'Chest',
  Cuello: 'Neck',
  'Bíceps derecho': 'Right biceps',
  'Bíceps izquierdo': 'Left biceps',
  'Pierna izquierda': 'Left leg',
  'Pierna derecha': 'Right leg',
  'Pantorrilla izquierda': 'Left calf',
  'Pantorrilla derecha': 'Right calf',
  // Importar medidas (ImportSheet kind='body', Body.jsx)
  'Importar medidas': 'Import measurements',
  'Sube o pega un CSV con una fila por día: una columna day (AAAA-MM-DD) y una columna por cada medida (%s…). Descarga la plantilla para ver los nombres exactos de las columnas.':
    'Upload or paste a CSV with one row per day: a day column (YYYY-MM-DD) and one column per measurement (%s…). Download the template to see the exact column names.',
  '%n días del CSV ya tienen medidas registradas.': '%n days in the CSV already have measurements.',
  Complementar: 'Complement',
  Reemplazar: 'Replace',
  'Reemplazar: el CSV sustituye por completo las medidas de esos días.':
    "Replace: the CSV fully overwrites those days' measurements.",
  'Complementar: conserva tus medidas y solo agrega o actualiza las del CSV.':
    'Complement: keeps your measurements and only adds or updates the CSV ones.',
  '%n medidas': '%n measurements',
  '%n días importados.': '%n days imported.',
  'fuera de rango': 'out of range',
  'sin medidas': 'no measurements',
  // Dashboard: tendencia por nutriente
  'Tendencia por nutriente': 'Trend by nutrient',
  'Elige cualquier nutriente y ve su valor día a día en el rango. La línea punteada es tu objetivo diario, si lo tienes en Metas.':
    'Pick any nutrient and see its day-by-day value over the range. The dashed line is your daily target, if you set one in Targets.',
  'Nutriente a graficar': 'Nutrient to chart',
  Macros: 'Macros',
  // Plantillas de comida (Today.jsx)
  Plantillas: 'Templates',
  'Plantillas de comida': 'Meal templates',
  'Aún no tienes plantillas. Guarda el día actual como una para reutilizarla en cualquier fecha.':
    "You don't have any templates yet. Save the current day as one to reuse it on any date.",
  '%n alimentos': '%n foods',
  'Nombre de la plantilla': 'Template name',
  'Guardar el día actual como plantilla': 'Save current day as a template',
  'Este día no tiene alimentos que guardar.': 'This day has no foods to save.',
  'Plantilla guardada.': 'Template saved.',
  'Las comidas de esta plantilla ya no existen.': 'The foods in this template no longer exist.',
  '%n añadidos · %m omitidos': '%n added · %m skipped',
  'Error al añadir.': 'Error adding.',
  // Import (ImportSheet, Foods, Today, Recipes)
  Importar: 'Import',
  'Importar alimentos': 'Import foods',
  'Importar registros': 'Import entries',
  'Subir archivo': 'Upload file',
  'Suelta el CSV aquí': 'Drop the CSV here',
  'Descargar plantilla': 'Download template',
  'Pega o sube un CSV: una fila por alimento, valores por 100 g. Columnas: name, kcal, protein_g, carbs_g, fat_g y una por cada micro (p. ej. sodio_mg).':
    'Paste or upload a CSV: one row per food, values per 100 g. Columns: name, kcal, protein_g, carbs_g, fat_g and one per micro (e.g. sodio_mg).',
  'Pega o sube un CSV: una fila por registro. Columnas: day (AAAA-MM-DD), meal, food, grams. El alimento se empareja por nombre con tu catálogo.':
    'Paste or upload a CSV: one row per entry. Columns: day (YYYY-MM-DD), meal, food, grams. Foods are matched by name against your catalog.',
  '%n filas · %v se importarán': '%n rows · %v will import',
  '%w con ⚠': '%w with ⚠',
  '(sin nombre)': '(no name)',
  'Importar %n': 'Import %n',
  'Error al importar.': 'Import failed.',
  '%n alimentos importados.': '%n foods imported.',
  '%n registros importados.': '%n entries imported.',
  'Pegar lista de ingredientes': 'Paste ingredient list',
  'Añadir del texto': 'Add from text',
  '%n añadidos · %m sin coincidencia (agrégalos arriba)': '%n added · %m unmatched (add them above)',
  '%n añadidos': '%n added',
  'sin alimento': 'no food',
  gramos: 'grams',
  fecha: 'date',
  componentes: 'components',
  // Nav (App.jsx)
  Hoy: 'Today',
  Alimentos: 'Foods',
  Recetas: 'Recipes',
  Objetivos: 'Targets',
  Dashboard: 'Dashboard',
  'Más opciones': 'More options',
  Etiquetas: 'Labels',
  'Cerrar sesión': 'Log out',
  IA: 'AI',
  Nombre: 'Name',
  P: 'P',
  C: 'C',
  Todos: 'All',
  'solo avisos': 'warnings only',
  'Sin alimentos aún': 'No foods yet',
  'Crear el primero': 'Create the first one',
  'Valores nutricionales requieren revisión': 'Nutritional values need review',
  'Sin resultados con estos filtros.': 'No results with these filters.',
  'Selecciona un alimento o crea uno nuevo': 'Select a food or create a new one',
  'Nuevo alimento': 'New food',
  'Añadir alimento': 'Add food',
  'Alimento borrado': 'Food deleted',
  'Error al guardar.': 'Error saving.',
  'Guardado.': 'Saved.',
  'Tiene registros asociados, no se puede borrar.': 'It has associated entries, it cannot be deleted.',
  'Solo puedes borrar tus propios alimentos.': 'You can only delete your own foods.',
  'Etiqueta transcrita': 'Transcribed label',
  'Estimación IA': 'AI estimate',
  confianza: 'confidence',
  alta: 'high',
  media: 'medium',
  baja: 'low',
  Volver: 'Back',
  'Editar alimento': 'Edit food',
  'Describe el alimento, pega un código de barras (EAN) o adjunta una foto de etiqueta/platillo':
    'Describe the food, paste a barcode (EAN) or attach a photo of the label/dish',
  'Etiqueta legible → se transcribe. EAN → Open Food Facts. Si no, estimación IA con chips USDA para genéricos. Siempre por 100 g; revisa antes de guardar.':
    'Readable label → transcribed. EAN → Open Food Facts. Otherwise AI estimate with USDA chips for generic foods. Always per 100 g; review before saving.',
  'Sin dato fiable de:': 'No reliable data for:',
  'La etiqueta y Open Food Facts difieren en:': 'The label and Open Food Facts differ in:',
  'Open Food Facts reporta edulcorantes:': 'Open Food Facts reports sweeteners:',
  'La cantidad casi nunca se declara; captúrala en su micro si la conoces.': 'The amount is rarely declared; enter it in its micro field if you know it.',
  Marca: 'Brand',
  'Valores por': 'Values per',
  'Base de los valores capturados': 'Base of the captured values',
  'se convertirá a 100 g al guardar': 'will be converted to 100 g on save',
  'Elige el tipo de líquido para convertir ml a gramos': 'Choose the liquid type to convert ml to grams',
  'Si dejas Kcal vacío, se guardará el cálculo por macros (≈ %n).':
    'If you leave Kcal empty, the macro-based calculation will be saved (≈ %n).',
  '%n kcal no cuadran con los macros (≈ %m kcal por Atwater). El alimento quedará marcado para revisión.':
    '%n kcal don\'t match the macros (≈ %m kcal by Atwater). The food will be flagged for review.',
  'Valores inusualmente altos para 100 g. Revisa antes de guardar.':
    'Unusually high values for 100 g. Review before saving.',
  'Componente inconsistente': 'Inconsistent component',
  'Revisa antes de guardar.': 'Review before saving.',
  'grasa saturada + trans supera la grasa total': 'saturated + trans fat exceeds total fat',
  'azúcar supera los carbohidratos': 'sugar exceeds carbs',
  'azúcar añadido supera el azúcar total': 'added sugar exceeds total sugar',
  'fibra supera los carbohidratos': 'fiber exceeds carbs',
  'polialcoholes superan los carbohidratos': 'polyols exceed carbs',
  'los polialcoholes desglosados superan su total': 'itemized polyols exceed their total',
  'los azúcares desglosados superan el azúcar total': 'itemized sugars exceed total sugar',
  'fibra soluble + insoluble supera la fibra total': 'soluble + insoluble fiber exceeds total fiber',
  'los tipos de grasa superan la grasa total': 'fat types exceed total fat',
  'ALA + EPA + DHA superan el omega-3 total': 'ALA + EPA + DHA exceed total omega-3',
  'LA + AA superan el omega-6 total': 'LA + AA exceed total omega-6',
  'Más micros (opcional)': 'More micros (optional)',
  '★ = favorito: aparece arriba junto a los principales.': '★ = favorite: appears above with the main ones.',
  '★ = favorito, se promueve arriba en móvil.': '★ = favorite, promoted above on mobile.',
  Líquido: 'Liquid',
  'No es líquido': 'Not a liquid',
  'Otro…': 'Other…',
  'densidad en g/ml': 'density in g/ml',
  'Densidad en g/ml': 'Density in g/ml',
  'Si es líquido, al registrar podrás capturar en ml y se convierte a gramos.':
    'If it\'s a liquid, when logging you can capture in ml and it converts to grams.',
  'Porciones (opcional)': 'Portions (optional)',
  'vaso, cucharada, rebanada…': 'glass, spoon, slice…',
  'Nombre de la porción': 'Portion name',
  'Cantidad de la porción': 'Portion amount',
  'Quitar porción': 'Remove portion',
  'Añadir porción': 'Add portion',
  Fuente: 'Source',
  Manual: 'Manual',
  'IA (Gemini)': 'AI (Gemini)',
  'de favoritos': 'from favorites',
  Marcar: 'Mark',
  'como favorito': 'as favorite',
  Sueño: 'Sleep',
  'Dormí menos de %n h': 'Slept under %n h',
  'Umbral del checkpoint de Medidas: “dormí menos de N horas”.': 'Measures checkpoint threshold: “slept under N hours”.',
  Menos: 'Less',
  Más: 'More',
  'Agua, café, té o caldo': 'Water, coffee, tea or broth',
  Leche: 'Milk',
  'Jugo o refresco': 'Juice or soda',
  'Yogur bebible o licuado': 'Drinkable yogurt or smoothie',
  'Bebida alcohólica': 'Alcoholic drink',
  Aceite: 'Oil',
  'Miel o jarabe': 'Honey or syrup',
  'Código de barras inválido: dígito verificador no coincide, revísalo':
    'Invalid barcode: check digit doesn\'t match, please review it',
  'EAN no encontrado en Open Food Facts.': 'EAN not found on Open Food Facts.',
  'No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.':
    'Could not fetch data. Check your connection or try another description/photo.',
  'Sin resultados en USDA.': 'No results on USDA.',
  'No se pudo obtener el detalle de USDA.': 'Could not fetch USDA detail.',
  'Error al guardar los ingredientes.': 'Error saving ingredients.',
  'Sin recetas aún': 'No recipes yet',
  'Crear la primera': 'Create the first one',
  'Selecciona una receta o crea una nueva': 'Select a recipe or create a new one',
  'Nueva receta': 'New recipe',
  'Añadir receta': 'Add recipe',
  'Receta borrada': 'Recipe deleted',
  'Quitar ingrediente': 'Remove ingredient',
  catálogo: 'catalog',
  'No se pudo crear un alimento nuevo. Intenta de nuevo.': 'Could not create a new food. Please try again.',
  'Editar receta': 'Edit recipe',
  'Describe el platillo o bebida (p. ej. «Caramel Macchiato 350ml») o adjunta una foto':
    'Describe the dish or drink (e.g. "Caramel Macchiato 350ml") or attach a photo',
  'Gemini descompone en ingredientes con nutrientes de respaldo (prefill revisable). Cada alimento nuevo se edita y guarda por separado; prioridad: catálogo › USDA › IA.':
    'Gemini breaks it down into ingredients with backup nutrients (editable prefill). Each new food is edited and saved separately; priority: catalog › USDA › AI.',
  'Ya la tienes:': 'You already have it:',
  'Continuar de todos modos': 'Continue anyway',
  'Ingredientes por IA (confianza %n) — revisa cantidades y nutrientes; guarda cada alimento nuevo.':
    'Ingredients by AI (confidence %n) — review amounts and nutrients; save each new food.',
  Ingredientes: 'Ingredients',
  'Añadir ingrediente…': 'Add ingredient…',
  'Peso cocido': 'Cooked weight',
  'vacío = suma de ingredientes': 'empty = sum of ingredients',
  '%n alimento%s nuevo%s sin guardar — se crea%n2 al guardar la receta, o guárdalo con ⤓.':
    '%n new food%s not saved yet — saved automatically when you save the recipe, or save individually with ⤓.',
  'La suma de ingredientes (%a) no cuadra con el total (%b).': 'The sum of ingredients (%a) doesn\'t match the total (%b).',
  'Ajustar ingredientes al total (×%n)': 'Adjust ingredients to total (×%n)',
  'Las kcal calculadas (%a) difieren de la estimación del platillo (%b) — revisa cantidades.':
    'The calculated kcal (%a) differ from the dish estimate (%b) — review amounts.',
  'Densidad calórica fuera de rango físico.': 'Caloric density out of physical range.',
  'Preview por 100 g': 'Preview per 100 g',
  'Se crearán %n alimento%s nuevo%s en tu catálogo:': '%n new food%s will be created in your catalog:',
  'Confirmar y guardar': 'Confirm and save',
  'Nombre del alimento': 'Food name',
  'Guardar alimento': 'Save food',
  'sin guardar': 'not saved',
  'valores por 100 g': 'values per 100 g',
  '¿Ya está en tu catálogo? Búscalo…': 'Already in your catalog? Search it…',
  'No se pudo guardar el alimento. Intenta de nuevo.': 'Could not save the food. Please try again.',
  hoy: 'today',
  'en %n %d': 'in %n %d',
  'hace %n %d': '%n %d ago',
  día: 'day',
  días: 'days',
  'No se pudo guardar.': 'Could not save.',
  'Sin fase vigente. Programa una fase para empezar.': 'No active phase. Schedule a phase to get started.',
  'Crear fase': 'Create phase',
  'Fases programadas': 'Scheduled phases',
  Programar: 'Schedule',
  'Sin fases programadas': 'No scheduled phases',
  'Sin nombre': 'No name',
  'sin fin': 'no end',
  'Borrar fase': 'Delete phase',
  'Fases previas': 'Previous phases',
  'Fechas específicas': 'Specific dates',
  Añadir: 'Add',
  'Sin fechas específicas aún': 'No specific dates yet',
  'vs fase': 'vs phase',
  'Borrar fecha específica': 'Delete specific date',
  '¿Borrar "%n"?': 'Delete "%n"?',
  'Se eliminarán sus 7 objetivos diarios. Esta acción no se puede deshacer.':
    'Its 7 daily targets will be deleted. This action cannot be undone.',
  'Nombre de fase': 'Phase name',
  'p. ej. Bulk único': 'e.g. Single bulk',
  Descripción: 'Description',
  'Objetivo de la fase': 'Phase goal',
  'Aplica desde': 'Applies from',
  'Semana de la fase': 'Phase week',
  'Copiar semana vigente': 'Copy current week',
  'tipo de día': 'day type',
  'tipos de día': 'day types',
  'Guardando…': 'Saving…',
  'Sin motivo': 'No reason',
  'Sustituye a "%n" ese día (%m kcal)': 'Replaces "%n" that day (%m kcal)',
  'la fase': 'the phase',
  'DÍA ÚNICO': 'SINGLE DAY',
  Fecha: 'Date',
  Motivo: 'Reason',
  'p. ej. Cumpleaños': 'e.g. Birthday',
  'kcal vs fase ese día': 'kcal vs phase that day',
  Micros: 'Micros',
  'inicia en %n %d': 'starts in %n %d',
  'duró %n %d': 'lasted %n %d',
  'día %n': 'day %n',
  'Separar un día': 'Split a day',
  'FASE VIGENTE': 'ACTIVE PHASE',
  'FASE PROGRAMADA': 'SCHEDULED PHASE',
  'NUEVA FASE': 'NEW PHASE',
  'FASE PREVIA': 'PREVIOUS PHASE',
  'FECHA ESPECÍFICA': 'SPECIFIC DATE',
  'NUEVA FECHA': 'NEW DATE',
  Meta: 'Goal',
  'Sin especificar': 'Not specified',
  'Guardar cambios': 'Save changes',
  'Corregir la fase': 'Correct the phase',
  'Reescribe el objetivo desde el %n. La adherencia pasada se recalcula.':
    'Rewrites the target from %n onward. Past adherence is recalculated.',
  'Nueva fase desde hoy': 'New phase from today',
  'Conserva el histórico intacto.': 'Keeps history intact.',
  fase: 'phase',
  fases: 'phases',
  'Ya existe una fase que aplica desde hoy.': 'A phase already applies from today.',
  'Ya existe una fase que aplica desde esa fecha.': 'A phase already applies from that date.',
  'No se pudo corregir la fase.': 'Could not correct the phase.',
  'No se pudo guardar la fase.': 'Could not save the phase.',
  'Ya existe una fecha específica para ese día.': 'A specific date already exists for that day.',
  'Cargando…': 'Loading…',
  Suma: 'Sum',
  Promedio: 'Average',
  'Mediana + IQR': 'Median + IQR',
  'Tu día típico. A diferencia del promedio, no la mueven los días raros (una fiesta, un ayuno). El paréntesis es el rango donde cae la mitad de tus días.':
    'Your typical day. Unlike the average, it isn\'t swayed by outlier days (a party, a fast). The parenthesis is the range where half your days fall.',
  'Desv. estándar + CV': 'Std. dev. + CV',
  'Qué tan parejo comes de un día a otro. Número chico = días parecidos. El % permite comparar kcal contra micros aunque midan cosas distintas.':
    'How consistent you eat from day to day. Small number = similar days. The % lets you compare kcal against micros even though they measure different things.',
  Tendencia: 'Trend',
  'Cuánto sube o baja tu consumo cada día, en promedio, a lo largo del periodo.':
    'How much your intake rises or falls each day, on average, over the period.',
  'Adherencia bayesiana': 'Bayesian adherence',
  'Qué tan seguido cumples tu objetivo, y qué tan confiable es esa cifra. Con pocos días el rango sale ancho: es honestidad, no un error.':
    'How often you hit your target, and how reliable that figure is. With few days the range comes out wide: that\'s honesty, not an error.',
  'No registraste nada en este periodo.': 'You didn\'t log anything in this period.',
  'Necesitas al menos %n días completos. Llevas %a completos y %b incompletos.':
    'You need at least %n complete days. You have %a complete and %b incomplete.',
  'Primero fija tus objetivos en Metas.': 'First set your targets in Targets.',
  'Necesitas al menos %n días completos en la fase actual. Llevas %a.':
    'You need at least %n complete days in the current phase. You have %a.',
  'Aún no tienes objetivo para este nutriente. Ponlo en la pestaña Metas.':
    'You don\'t have a target for this nutrient yet. Set it in the Targets tab.',
  'Cuenta como día cumplido si comiste al menos %n mg de sodio.': 'Counts as a met day if you ate at least %n mg of sodium.',
  'Cuenta como día cumplido si el sodio quedó entre %a y %b mg.': 'Counts as a met day if sodium stayed between %a and %b mg.',
  'Cuenta como día cumplido si quedaste a ±%n% de tu objetivo.': 'Counts as a met day if you landed within ±%n% of your target.',
  'Cuenta como día cumplido si llegaste a tu objetivo o lo pasaste.': 'Counts as a met day if you reached or exceeded your target.',
  'Cuenta como día cumplido si te quedaste en o bajo tu objetivo.': 'Counts as a met day if you stayed at or below your target.',
  'probablemente entre %a y %b%': 'likely between %a and %b%',
  'Sin objetivo': 'No target',
  'Tu día típico: %n kcal (la mitad de tus días cae entre %a y %b)':
    'Your typical day: %n kcal (half your days fall between %a and %b)',
  'consistencia alta': 'high consistency',
  'consistencia media': 'medium consistency',
  'consistencia baja': 'low consistency',
  'Varías ±%n kcal entre días': 'You vary ±%n kcal between days',
  Subes: 'You go up',
  Bajas: 'You go down',
  '%v ~%n kcal por día ≈ %m por semana': '%v ~%n kcal per day ≈ %m per week',
  'Cumples tu objetivo ~%n de cada 10 días': 'You hit your target ~%n out of every 10 days',
  'Suma del rango': 'Sum of range',
  'Promedio diario (÷ días registrados)': 'Daily average (÷ logged days)',
  'Mediana (P25–P75)': 'Median (P25–P75)',
  'Desviación estándar (CV)': 'Standard deviation (CV)',
  'Tendencia (unidades/día)': 'Trend (units/day)',
  'Adherencia bayesiana (IC 95%)': 'Bayesian adherence (95% CI)',
  'Día típico (rango medio)': 'Typical day (mid-range)',
  Variabilidad: 'Variability',
  Adherencia: 'Adherence',
  Días: 'Days',
  Objetivo: 'Target',
  'Promedio 7 días': 'Average 7 days',
  Exportar: 'Export',
  'Registros día por día': 'Day-by-day entries',
  'Cada alimento del rango con sus macros y micros. No aplica la operación seleccionada.':
    'Every food in the range with its macros and micros. The selected operation does not apply.',
  'Resumen del periodo': 'Period summary',
  'Una fila por métrica con valor según la operación activa, objetivo y % de adherencia.':
    'One row per metric with its value under the active operation, target, and adherence %.',
  'Informe del periodo': 'Period report',
  'Resumen ejecutivo con gráfica y tablas, listo para guardar como PDF.':
    'Executive summary with chart and tables, ready to save as PDF.',
  'Generado el %n': 'Generated on %n',
  'Guardar PDF': 'Save PDF',
  '%a de %b días registrados · %c completos': '%a of %b days logged · %c complete',
  Detalle: 'Detail',
  Macronutrientes: 'Macronutrients',
  'Micronutrientes visibles': 'Visible micronutrients',
  '— = sin dato o sin objetivo en el rango.': '— = no data or no target in the range.',
  '⚠ = micro en 0 la mayoría de los días: puede significar "no anotado", no "no consumido".':
    '⚠ = micro at 0 most days: it can mean "not logged", not "not eaten".',
  Custom: 'Custom',
  // Rango custom guardado (Dashboard): "Hoy" ya está arriba (preset), reusa clave.
  Inicio: 'Start',
  Fin: 'End',
  'Hasta hoy': 'Through today',
  'El rango crece solo: mañana incluirá un día más.': 'The range grows on its own: tomorrow it will include one more day.',
  'Nombre (opcional)': 'Name (optional)',
  'Guardar rango': 'Save range',
  'La fecha de inicio va después del fin.': 'The start date comes after the end date.',
  'Personalizado…': 'Custom…',
  'Elige un rango de fechas': 'Pick a date range',
  'Guarda un rango para reutilizarlo aquí.': 'Save a range to reuse it here.',
  'Editar rango': 'Edit range',
  'Eliminar rango': 'Delete range',
  '%d días': '%d days',
  Fases: 'Phases',
  'Fase actual': 'Current phase',
  'Fase previa': 'Previous phase',
  'La fase seleccionada ya no tiene días registrados — mostrando la última semana.':
    'The selected phase no longer has logged days — showing the last week.',
  'El día en curso no se incluye: el Dashboard analiza días terminados. Para hoy usa el rango "Hoy".':
    'The current day is not included: the Dashboard analyzes finished days. For today use the "Today" range.',
  '%n fases de %s · %d días.': '%n phases of %s · %d days.',
  'No hay periodo anterior con qué comparar: los días antes del %n eran de otra fase, con otros objetivos.':
    'There\'s no previous period to compare: the days before %n belonged to another phase, with different targets.',
  'Sin comparación vs periodo previo': 'No comparison vs previous period',
  Avanzadas: 'Advanced',
  'Kcal por día': 'Kcal per day',
  'La línea sólida es lo que comiste cada día. La punteada suaviza esos altibajos con el promedio de los últimos 7 días, para ver la tendencia sin el ruido diario. La banda tenue marca ±10% de tu objetivo.':
    'The solid line is what you ate each day. The dotted one smooths those ups and downs with the 7-day average, so you can see the trend without daily noise. The faint band marks ±10% of your target.',
  'Distribución de macros (kcal)': 'Macro distribution (kcal)',
  'Cada franja es un macronutriente (proteína, carbos, grasa) y su grosor es cuánto pesó ese día en tus calorías. Lee el ancho de cada color, no la altura total del área.':
    'Each band is a macronutrient (protein, carbs, fat) and its thickness is how much it weighed in your calories that day. Read the width of each color, not the total height of the area.',
  'Sin registros en el rango': 'No entries in this range',
  'Huella nutricional (micros vs. objetivo)': 'Nutritional footprint (micros vs. target)',
  'Cada punta es un micronutriente. Cuanto más lejos del centro, más cerca (o por encima) llegaste de tu objetivo ese periodo — el borde del gráfico es 150%.':
    'Each point is a micronutrient. The further from the center, the closer (or over) you got to your target that period — the edge of the chart is 150%.',
  'Registra objetivos de micros en Metas': 'Set micro targets in Targets',
  'Adherencia (kcal por día)': 'Adherence (kcal per day)',
  'en meta (±5%)': 'on target (±5%)',
  'cerca (±15%)': 'close (±15%)',
  'lejos (>15%)': 'off (>15%)',
  'sin registro': 'not logged',
  'Proteína semanal vs piso': 'Weekly protein vs floor',
  Piso: 'Floor',
  'Sodio diario vs piso': 'Daily sodium vs floor',
  'Sodio diario vs piso y techo': 'Daily sodium vs floor and ceiling',
  'Top alimentos': 'Top foods',
  'Nutriente': 'Nutrient',
  'En %a de %b días no registraste este nutriente. El 0 puede significar \'no lo anotaste\', no \'no lo comiste\'.':
    'On %a of %b days you didn\'t log this nutrient. The 0 can mean \'you didn\'t note it\', not \'you didn\'t eat it\'.',
  'sodio promedio': 'average sodium',
  'vs. anterior': 'vs. previous',
  '%a días con todo registrado y %b a los que parece faltarles comidas, de %c días del periodo.':
    '%a days fully logged and %b that seem to be missing meals, out of %c days in the period.',
  'día incompleto: parece que faltaron comidas': 'incomplete day: seems to be missing meals',
  'Todavía no tienes una fase en curso. Créala en Metas.': 'You don\'t have an ongoing phase yet. Create one in Targets.',
  'Solo llevas una fase. La anterior aparecerá cuando empieces la siguiente.':
    'You only have one phase so far. The previous one will appear once you start the next.',
  'en el histórico': 'in your history',
  'No has marcado ninguna fase como %n. Puedes hacerlo en Metas.': 'You haven\'t marked any phase as %n yet. You can do it in Targets.',
  Déficit: 'Deficit',
  Volumen: 'Bulk',
  Recomposición: 'Recomposition',
  Mantenimiento: 'Maintenance',
  Unidades: 'Units',
  'Cambiar a': 'Switch to',
  Idioma: 'Language',
  Tema: 'Theme',
  Auto: 'Auto',
  Claro: 'Light',
  Oscuro: 'Dark',

  // Login.jsx
  'Email o contraseña incorrectos.': 'Incorrect email or password.',
  Contraseña: 'Password',
  'Entrando…': 'Signing in…',
  Entrar: 'Sign in',

  // Today.jsx — cabecera y resumen
  'Día anterior': 'Previous day',
  'Día siguiente': 'Next day',
  'Elegir fecha': 'Choose date',
  'Estado actual': 'Current status',
  'Ver objetivos': 'View targets',
  'Ver estado actual': 'View current status',
  Mini: 'Mini',
  Ver: 'View',
  'Personalizar resumen': 'Customize summary',
  'Diseño actual': 'Current layout',
  'cámbialo con las flechas de la card': 'switch it with the card arrows',
  'Variable principal': 'Primary variable',
  'Faltante absoluto': 'Remaining (absolute)',
  'Faltante en %': 'Remaining (%)',
  Metas: 'Targets',
  Nutrientes: 'Nutrients',
  'El orden asigna el lugar: 1º anillo, 2º–4º barras, resto tarjetas.': 'Order assigns the slot: 1st ring, 2nd–4th bars, rest tiles.',
  Subir: 'Move up',
  Bajar: 'Move down',
  Quitar: 'Remove',
  'Añadir nutriente…': 'Add nutrient…',
  'Añadir nutriente': 'Add nutrient',
  Básicos: 'Basics',
  'El aviso de sodio < %n mg se muestra siempre, aunque quites el sodio de la lista.': 'The sodium < %n mg warning always shows, even if you remove sodium from the list.',
  'Aplicar a los 3 diseños': 'Apply to all 3 designs',
  'sin meta de': 'no target for',
  Kcal: 'Kcal',
  Prot: 'Prot',
  Proteína: 'Protein',
  Carbs: 'Carbs',
  Grasa: 'Fat',
  Sodio: 'Sodium',
  Potasio: 'Potassium',
  'en meta': 'on target',
  'sin meta de kcal': 'no kcal target',
  'al piso': 'to floor',
  'sobre el techo': 'over ceiling',
  piso: 'floor',
  techo: 'ceiling',
  meta: 'target',
  de: 'of',

  // Water card
  Agua: 'Water',
  'Ajustes de agua': 'Water settings',
  'Cantidad (ml)': 'Amount (ml)',
  'Cantidad (fl oz)': 'Amount (fl oz)',
  'Quitar último registro de agua': 'Remove last water entry',
  'Añadir vaso de %n': 'Add %n glass',
  'Tamaño de vaso (ml)': 'Glass size (ml)',
  'Tamaño de vaso (fl oz)': 'Glass size (fl oz)',
  Guardar: 'Save',

  // Sodium warning
  '⚠ sodio < %n mg': '⚠ sodium < %n mg',
  '⚠ sodio > %n mg': '⚠ sodium > %n mg',
  'Sin registros este día': 'No entries this day',

  // Entry sections / cards
  'Sin etiqueta': 'No label',
  Expandir: 'Expand',
  Contraer: 'Collapse',
  'Añadir a %n': 'Add to %n',
  Editar: 'Edit',
  Borrar: 'Delete',
  'Añadir registro': 'Add entry',
  'Registro borrado': 'Entry deleted',
  Deshacer: 'Undo',
  Cerrar: 'Close',

  // Add/edit entry form
  'Elementos frecuentes': 'Frequent items',
  'Alimento o receta': 'Food or recipe',
  'Buscar…': 'Search…',
  receta: 'recipe',
  Etiqueta: 'Label',
  Cancelar: 'Cancel',
  Registrar: 'Log',
  Aporta: 'Provides',
  'Más micros (%n)': 'More micros (%n)',
  g: 'g',

  // Section menu (Ayer/Copiar/Pegar/Borrar día)
  Ayer: 'Yesterday',
  Copiar: 'Copy',
  'Pegar %n': 'Paste %n',
  'Borrar día': 'Delete day',
  'Día copiado.': 'Day copied.',
  'Ese día no tiene registros.': 'That day has no entries.',
  'Error al copiar.': 'Error copying.',
  '%n registros copiados.': '%n entries copied.',
  'Este día no tiene alimentos.': 'This day has no foods.',
  '¿Borrar los %n registros de alimentos de este día? No se puede deshacer.':
    'Delete the %n food entries for this day? This cannot be undone.',
  'Error al borrar.': 'Error deleting.',
  '%n registros borrados.': '%n entries deleted.',
  'Error al registrar agua.': 'Error logging water.',
  'Alto en sodio': 'High in sodium',
  'Alto en potasio': 'High in potassium',
  G: 'F', // abreviatura de Grasa/Fat en las cards de Hoy

  // MICROS (domain.js) — etiquetas traducidas en el punto de render (t(m.label)),
  // la constante y sus claves de jsonb no se tocan.
  'Grasa sat.': 'Sat. fat',
  'Grasa trans': 'Trans fat',
  Azúcar: 'Sugar',
  'Azúcar añadido': 'Added sugar',
  Fibra: 'Fiber',
  Magnesio: 'Magnesium',
  Calcio: 'Calcium',
  Hierro: 'Iron',
  Alcohol: 'Alcohol',
  Colesterol: 'Cholesterol',
  'Vit. A': 'Vit. A',
  'Vit. C': 'Vit. C',
  'Vit. D': 'Vit. D',
  'Vit. E': 'Vit. E',
  'Vit. K': 'Vit. K',
  'B1 Tiamina': 'B1 Thiamine',
  'B2 Riboflavina': 'B2 Riboflavin',
  'B3 Niacina': 'B3 Niacin',
  'B5 Ác. pantoténico': 'B5 Pantothenic acid',
  B6: 'B6',
  'B7 Biotina': 'B7 Biotin',
  'B9 Folato': 'B9 Folate',
  B12: 'B12',
  Colina: 'Choline',
  Zinc: 'Zinc',
  Fósforo: 'Phosphorus',
  Selenio: 'Selenium',
  Cobre: 'Copper',
  Manganeso: 'Manganese',
  Yodo: 'Iodine',
  Cromo: 'Chromium',
  Molibdeno: 'Molybdenum',
  'β-caroteno': 'β-carotene',
  Licopeno: 'Lycopene',
  'Luteína + Zeaxantina': 'Lutein + Zeaxanthin',
  // — ampliación paridad Cronometer (los idénticos ES=EN se omiten: fallback) —
  'Fibra soluble': 'Soluble fiber',
  'Fibra insoluble': 'Insoluble fiber',
  Almidón: 'Starch',
  Sacarosa: 'Sucrose',
  Glucosa: 'Glucose',
  Fructosa: 'Fructose',
  Galactosa: 'Galactose',
  Lactosa: 'Lactose',
  Maltosa: 'Maltose',
  Alulosa: 'Allulose',
  'Polialcoholes (total)': 'Sugar alcohols (total)',
  Eritritol: 'Erythritol',
  Xilitol: 'Xylitol',
  Manitol: 'Mannitol',
  Aspartamo: 'Aspartame',
  Sucralosa: 'Sucralose',
  'Acesulfamo K': 'Acesulfame K',
  Sacarina: 'Saccharin',
  Ciclamato: 'Cyclamate',
  'Glucósidos de esteviol': 'Steviol glycosides',
  'Mogrósidos (fruto del monje)': 'Mogrosides (monk fruit)',
  Neotamo: 'Neotame',
  Advantamo: 'Advantame',
  Taumatina: 'Thaumatin',
  'Grasa monoinsaturada': 'Monounsaturated fat',
  'Grasa poliinsaturada': 'Polyunsaturated fat',
  Fitosteroles: 'Phytosterols',
  'β-tocoferol': 'β-tocopherol',
  'γ-tocoferol': 'γ-tocopherol',
  'δ-tocoferol': 'δ-tocopherol',
  'α-caroteno': 'α-carotene',
  'β-criptoxantina': 'β-cryptoxanthin',
  Fluoruro: 'Fluoride',
  Cafeína: 'Caffeine',
  Teobromina: 'Theobromine',
  Ceniza: 'Ash',
  'β-hidroxibutirato': 'β-hydroxybutyrate',
  Oxalato: 'Oxalate',
  Fitato: 'Phytate',
  Triptófano: 'Tryptophan',
  Treonina: 'Threonine',
  Isoleucina: 'Isoleucine',
  Leucina: 'Leucine',
  Lisina: 'Lysine',
  Metionina: 'Methionine',
  Cistina: 'Cystine',
  Fenilalanina: 'Phenylalanine',
  Tirosina: 'Tyrosine',
  Valina: 'Valine',
  Arginina: 'Arginine',
  Histidina: 'Histidine',
  Alanina: 'Alanine',
  'Ácido aspártico': 'Aspartic acid',
  'Ácido glutámico': 'Glutamic acid',
  Glicina: 'Glycine',
  Prolina: 'Proline',
  Serina: 'Serine',
  Hidroxiprolina: 'Hydroxyproline',

  // LabelsModal.jsx
  'Nueva etiqueta': 'New label',
  'Sin etiquetas aún': 'No labels yet',
  '¿Borrar': 'Delete',
  'Los registros con esta etiqueta quedarán sin sección. No se puede deshacer.':
    'Entries with this label will lose their section. This cannot be undone.',
  'Borrar etiqueta': 'Delete label',

  // AiDataCard.jsx
  'Datos con IA': 'AI data',
  'Foto (etiqueta o platillo)': 'Photo (label or dish)',
  'Otra foto': 'Another photo',
  'Quitar foto': 'Remove photo',
  'Arrastra para reposicionar': 'Drag to reposition',
  Acercar: 'Zoom',
  'Obteniendo…': 'Fetching…',
  'Obtener datos': 'Get data',

  // AmountField.jsx
  Mililitros: 'Milliliters',
  Gramos: 'Grams',
  densidad: 'density',

  // Categorías de MICROS (microGroups)
  Lípidos: 'Lipids',
  Carbohidratos: 'Carbohydrates',
  Edulcorantes: 'Sweeteners',
  Aminoácidos: 'Amino acids',
  Vitaminas: 'Vitamins',
  Minerales: 'Minerals',
  Antioxidantes: 'Antioxidants',
  Otros: 'Other',

  // Menú de usuario (UserMenu, Profile/Region/Settings sheets)
  'Menú de usuario': 'User menu',
  Perfil: 'Profile',
  'Idioma y unidades': 'Language and units',
  Configuración: 'Settings',
  'Tu perfil': 'Your profile',
  'Guardar perfil': 'Save profile',
  'Foto de perfil': 'Profile photo',
  'Se usa como avatar del menú.': 'Used as your menu avatar.',
  'Segundo nombre': 'Middle name',
  Apellidos: 'Last name',
  Nacimiento: 'Date of birth',
  'Altura (cm)': 'Height (cm)',
  Sexo: 'Sex',
  Masculino: 'Male',
  Femenino: 'Female',
  'Prefiero no decir': 'Prefer not to say',
  'Cambiar contraseña': 'Change password',
  'Cambia la contraseña de tu cuenta. Se aplica de inmediato.': 'Change your account password. Applied immediately.',
  'Nueva contraseña': 'New password',
  'Confirmar contraseña': 'Confirm password',
  'Mostrar contraseña': 'Show password',
  'Ocultar contraseña': 'Hide password',
  'Mínimo 6 caracteres': 'Minimum 6 characters',
  'Las contraseñas no coinciden': 'Passwords don’t match',
  'Actualizar contraseña': 'Update password',
  'Actualizando…': 'Updating…',
  'Contraseña actualizada': 'Password updated',
  'Úsala la próxima vez que inicies sesión.': 'Use it next time you sign in.',
  'La nueva contraseña debe ser distinta de la actual.': 'The new password must be different from the current one.',
  'No se pudo actualizar la contraseña. Intenta de nuevo.': 'Couldn’t update the password. Try again.',
  Listo: 'Done',
  'Sistema de unidades': 'Unit system',
  'Métrico · g · ml': 'Metric · g · ml',
  'Imperial · oz · fl oz': 'Imperial · oz · fl oz',
  métrico: 'metric',
  imperial: 'imperial',
  Restaurar: 'Restore',
  'Rango de gracia por arquetipo. Afecta los colores de Hoy y Dashboard.': 'Grace range per archetype. Affects Today and Dashboard colors.',
  diana: 'target',
  rango: 'range',
  'Sin régimen': 'No regimen',
  'Mant.': 'Maint.',
  'Recomp.': 'Recomp.',
  'En meta · defecto': 'On target · under',
  'En meta · exceso': 'On target · over',
  'Aviso · defecto': 'Warning · under',
  'Aviso · exceso': 'Warning · over',
  'En meta': 'On target',
  Aviso: 'Warning',
  'Carbs · Grasa': 'Carbs · Fat',
  'Límites (grasa sat., azúcar añadido…)': 'Limits (sat. fat, added sugar…)',
  'Holgura sobre el techo antes del aviso': 'Slack above the ceiling before warning',
  'Piso médico fijo, no configurable.': 'Fixed medical floor, not configurable.',
  'Secciones de comida': 'Meal sections',

  // CustomChart.jsx ("Mis gráficas") — faltaban por completo
  'Mis gráficas': 'My charts',
  Nueva: 'New',
  'Nueva gráfica': 'New chart',
  'Editar gráfica': 'Edit chart',
  'Guardar gráfica': 'Save chart',
  'Opciones de la gráfica': 'Chart options',
  Eliminar: 'Delete',
  'Sin datos en el rango': 'No data in range',
  Título: 'Title',
  Opcional: 'Optional',
  Tipo: 'Type',
  Línea: 'Line',
  Barras: 'Bars',
  Granularidad: 'Granularity',
  Día: 'Day',
  Semana: 'Week',
  Mes: 'Month',
  Mediana: 'Median',
  'Reductor por bucket': 'Bucket reducer',
  'Eje izq: %l · Eje der: %r': 'Left axis: %l · Right axis: %r',
  'Máximo %n variables': 'Max %n variables',
  'Máximo %n unidades por gráfica': 'Max %n units per chart',
  'Cómo se agrupan los días en el tiempo. Auto lo decide por el rango: hasta ~mes → día, hasta ~medio año → semana, más → mes. Así un año no pinta 365 puntos.':
    "How days are grouped over time. Auto decides by range: up to ~a month → day, up to ~half a year → week, more → month. That way a year doesn't plot 365 points.",
  'Elige de 1 a %v variables. Con 2 unidades distintas se usan 2 ejes (izquierda y derecha), como Peso (kg) + Cintura (cm). Para una 3ª unidad, crea otra gráfica.':
    'Pick 1 to %v variables. With 2 different units, 2 axes are used (left and right), like Weight (kg) + Waist (cm). For a 3rd unit, create another chart.',
  'En granularidad Día el reductor no aplica (un punto por día).':
    "At Day granularity the reducer doesn't apply (one point per day).",
  'Suma deshabilitada: la gráfica incluye una medida (peso/circunferencia/derivada). Usa Promedio o Mediana.':
    'Sum disabled: the chart includes a measurement (weight/circumference/derived). Use Average or Median.',
  'Sumar medidas no tiene sentido; usa Promedio o Mediana': 'Summing measurements makes no sense; use Average or Median',
  'Crea una gráfica para cruzar cualquier variable en el tiempo': 'Create a chart to cross any variable over time',
  'peso, medidas, macros, micros o derivadas — línea o barras': 'weight, measurements, macros, micros or derived — line or bars',

  // Dashboard.jsx — cabecera del análisis estándar
  'Análisis estándar': 'Standard analysis',
  'radar micros · adherencia · sodio · Bayes': 'micros radar · adherence · sodium · Bayes',
  'Mostrar ▾': 'Show ▾',
  'Ocultar ▴': 'Hide ▴',

  // Body.jsx — labels de BODY_METRICS (domain.js) que faltaban
  Altura: 'Height',
  IMC: 'BMI',
  'Masa libre de grasa': 'Fat-free mass',
  'Agua corporal (L)': 'Body water (L)',
  'Magra tronco': 'Trunk lean',
  'Magra brazo izq.': 'Left arm lean',
  'Magra brazo der.': 'Right arm lean',
  'Magra pierna izq.': 'Left leg lean',
  'Magra pierna der.': 'Right leg lean',
  'Grasa tronco': 'Trunk fat',
  'Grasa brazo izq.': 'Left arm fat',
  'Grasa brazo der.': 'Right arm fat',
  'Grasa pierna izq.': 'Left leg fat',
  'Grasa pierna der.': 'Right leg fat',

  // Body.jsx — derivadas de solo lectura
  Derivadas: 'Derived',
  'Ver fórmula': 'View formula',
  altura: 'height',
  grasa: 'fat',
  y: 'and',
  'Se calculan con tu peso del día y tu última %s registrada.': 'Calculated from your weight that day and your last recorded %s.',

  // Today.jsx
  'Ver resumen del día': 'View day summary',

  // Toasts de error de carga (showToast) — antes solo en español
  'No se pudieron cargar los objetivos — revisa tu conexión.': 'Could not load targets — check your connection.',
  'No se pudieron cargar las recetas — revisa tu conexión.': 'Could not load recipes — check your connection.',
  'No se pudieron cargar los alimentos — revisa tu conexión.': 'Could not load foods — check your connection.',
  'No se pudieron cargar las etiquetas — revisa tu conexión.': 'Could not load labels — check your connection.',
  'No se pudo cargar el Dashboard — revisa tu conexión.': 'Could not load the Dashboard — check your connection.',
  'No se pudo cargar el día — revisa tu conexión.': 'Could not load the day — check your connection.',
};

const LANG_KEY = 'nutri-lang';
const VALID = ['es', 'en'];

function detect() {
  const raw = localStorage.getItem(LANG_KEY);
  if (VALID.includes(raw)) return raw;
  return navigator.language?.startsWith('es') ? 'es' : 'en';
}

let lang = detect();
let userId = null;
const subs = new Set();

export function getLang() {
  return lang;
}

// patch-merge sobre prefs.data: es un jsonb compartido con otras prefs
// (water_glass_ml, today_view, …), así que un upsert directo con solo
// { lang } las borraría.
export async function persistPrefsKey(key, value) {
  if (!userId) return;
  const { data } = await supabase.from('prefs').select('data').maybeSingle();
  await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), [key]: value } });
}

export function setLang(next, { persist = true } = {}) {
  if (!VALID.includes(next) || next === lang) return;
  lang = next;
  localStorage.setItem(LANG_KEY, next);
  subs.forEach((fn) => fn(lang));
  if (persist) persistPrefsKey('lang', next);
}

// Registra el usuario autenticado (para poder persistir en prefs) y aplica
// prefs.data.lang si difiere de localStorage — gana prefs (cross-device),
// pero sin re-escribirlo (persist:false, ya viene de ahí).
export function registerLangUser(uid, prefLang) {
  userId = uid;
  if (VALID.includes(prefLang) && prefLang !== lang) setLang(prefLang, { persist: false });
}

// --- Unidades: SI (g/ml) vs US customary (oz/fl oz) --------------------
// Solo cambia cómo se capturan/muestran CANTIDADES de alimento y agua.
// Los nutrientes (g de proteína, mg de sodio…) nunca cambian de unidad, y la
// DB siempre recibe gramos/ml — la conversión vive solo en display/captura,
// mismo patrón que la densidad de AmountField.
const UNITS_KEY = 'nutri-units';
const VALID_UNITS = ['metric', 'us'];
const OZ_G = 28.3495;
const FLOZ_ML = 29.5735;

function detectUnits() {
  const raw = localStorage.getItem(UNITS_KEY);
  if (VALID_UNITS.includes(raw)) return raw;
  const l = navigator.language || '';
  return /^en-US$|^en$/.test(l) ? 'us' : 'metric';
}

let units = detectUnits();
const unitSubs = new Set();

export function getUnits() {
  return units;
}

export function setUnits(next, { persist = true } = {}) {
  if (!VALID_UNITS.includes(next) || next === units) return;
  units = next;
  localStorage.setItem(UNITS_KEY, next);
  unitSubs.forEach((fn) => fn(units));
  if (persist) persistPrefsKey('units', next);
}

export function registerUnitsUser(prefUnits) {
  if (VALID_UNITS.includes(prefUnits) && prefUnits !== units) setUnits(prefUnits, { persist: false });
}

export function useUnits() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    unitSubs.add(fn);
    return () => unitSubs.delete(fn);
  }, []);
  return units;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Cantidad de alimento: gramos siempre en DB, oz solo en display.
export function fmtG(grams) {
  const n = Number(grams) || 0;
  if (units !== 'us') return `${round1(n)} g`;
  const oz = n / OZ_G;
  return `${Math.round(oz * (oz < 1 ? 100 : 10)) / (oz < 1 ? 100 : 10)} oz`;
}

// Cantidad de agua: ml siempre en DB, fl oz solo en display.
export function fmtMl(ml) {
  const n = Number(ml) || 0;
  if (units !== 'us') return `${round1(n)} ml`;
  const floz = n / FLOZ_ML;
  return `${Math.round(floz * (floz < 1 ? 100 : 10)) / (floz < 1 ? 100 : 10)} fl oz`;
}

export function gToOz(g) {
  return Number(g) / OZ_G;
}
export function ozToG(oz) {
  return Number(oz) * OZ_G;
}
export function mlToFlOz(ml) {
  return Number(ml) / FLOZ_ML;
}
export function flOzToMl(floz) {
  return Number(floz) * FLOZ_ML;
}

export function locale() {
  return lang === 'en' ? 'en-US' : 'es-MX';
}

export function t(str) {
  if (lang !== 'en') return str;
  return EN[str] ?? str;
}

export function useLang() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return lang;
}

// --- Perfil del usuario (menú de usuario → Perfil) ---------------------
// Datos personales en prefs.data.profile (jsonb, sin migración). Solo display:
// altura/sexo/nacimiento alimentan cálculos futuros (TMB/IMC), no afectan aún la
// exactitud de los nutrientes almacenados. La foto vive en el bucket body-photos
// bajo {uid}/avatar/…; aquí solo se guarda su ruta (profile.avatar_path).
let profile = {};
const profileSubs = new Set();

export function getProfile() {
  return profile;
}
export function setProfile(next, { persist = true } = {}) {
  profile = next || {};
  profileSubs.forEach((fn) => fn(profile));
  if (persist) persistPrefsKey('profile', profile);
}
export function registerProfile(p) {
  if (p && typeof p === 'object') setProfile(p, { persist: false });
}
export function useProfile() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    profileSubs.add(fn);
    return () => profileSubs.delete(fn);
  }, []);
  return profile;
}

// Nombre para mostrar, derivado del perfil.
export function displayName() {
  const parts = [profile.first_name, profile.last_name].filter(Boolean);
  return parts.join(' ').trim() || t('Tu perfil');
}

// --- Umbral de sueño (menú de usuario → Configuración) -----------------
// Horas bajo las cuales el checkpoint "Sueño" de Medidas se considera "dormí poco".
// Solo metadato de UI (prefs.data.sueno_umbral_h, sin migración); el valor marcado
// que se guarda por día es este umbral, para que el flag se autoexplique si cambia.
let sleepThreshold = 6;
const sleepSubs = new Set();
export function getSleepThreshold() {
  return sleepThreshold;
}
export function setSleepThreshold(next, { persist = true } = {}) {
  const n = Number(next);
  if (!Number.isFinite(n) || n <= 0) return;
  sleepThreshold = n;
  sleepSubs.forEach((fn) => fn(sleepThreshold));
  if (persist) persistPrefsKey('sueno_umbral_h', n);
}
export function registerSleepThreshold(v) {
  if (v != null) setSleepThreshold(v, { persist: false });
}
export function useSleepThreshold() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    sleepSubs.add(fn);
    return () => sleepSubs.delete(fn);
  }, []);
  return sleepThreshold;
}

// --- Bandas de adherencia (menú de usuario → Configuración) ------------
// El estado y la matemática viven en domain.js (puro); aquí van la persistencia
// (prefs.data.adherence_bands), la carga y el hook de re-render para Hoy/Dashboard.
export function saveAdherenceBands(overrides) {
  setActiveBands(overrides);
  persistPrefsKey('adherence_bands', overrides || {});
}
export function registerAdherenceBands(overrides) {
  if (overrides && typeof overrides === 'object') setActiveBands(overrides);
}
export function useAdherenceBands() {
  const [, force] = useState(0);
  useEffect(() => subscribeBands(() => force((n) => n + 1)), []);
  return getActiveBands();
}
