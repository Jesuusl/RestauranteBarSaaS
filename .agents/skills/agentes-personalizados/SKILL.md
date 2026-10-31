---
name: agentes-personalizados
description: >-
  Guía y referencia para crear, configurar e invocar Agentes Personalizados (Custom Agents) en Antigravity.
  Úsala cuando necesites definir nuevos agentes especializados para el proyecto, configurar su YAML frontmatter
  (herramientas, modelo, permisos, skills, simetría de ejecución) o invocarlos vía CLI, IDE o como subagentes.
---

# Agentes Personalizados (Custom Agents) en Antigravity

Los **Agentes Personalizados** permiten estructurar la ingeniería de software como una orquestación de agentes especializados con división de trabajo. En lugar de sobrecargar un único asistente generalista con un prompt monolítico, cada agente personalizado cuenta con su propio rol acotado, instrucciones del sistema, modelo, herramientas y políticas de seguridad específicas.

---

## Ubicación de los Archivos de Agente

Los agentes se definen en archivos individuales con extensión `.md`:

| Ámbito | Ruta | Descripción |
| :--- | :--- | :--- |
| **Proyecto / Workspace** *(Recomendado)* | `.agents/agents/<nombre-agente>.md` | Versionado en el repositorio (Git). Queda disponible inmediatamente para todo el equipo sin configuración manual. |
| **Global / Usuario** | `~/.gemini/config/agents/<nombre-agente>.md` | Disponible para todos los proyectos en la máquina del desarrollador. |

> [!NOTE]
> Para este proyecto, los agentes específicos deben colocarse en `.agents/agents/`.

---

## Formato del Archivo de Agente

Un archivo de agente personalizado consta de un bloque **YAML frontmatter** con la configuración de ejecución, seguido de un cuerpo en **Markdown** que se compila directamente en las instrucciones de sistema (*Core Instructions / System Prompt*).

### Estructura Base (Blueprint 101)

```markdown
---
name: dependency-modernizer
description: Ayuda a actualizar dependencias del proyecto y verifica que las pruebas pasen.
model: flash
tools:
  - view_file
  - replace_file_content
  - manage_task
  - run_command
skills:
  - skills/package-upgrade-rules
mainAgent: true
subagent: true
permissionMode: acceptEdits
commandExecutionPolicy: auto
---

# Core Instructions
Eres un modernizador de dependencias especializado. Tu responsabilidad es:
1. Inspeccionar los archivos de configuración de dependencias del proyecto.
2. Actualizar las dependencias objetivo a versiones compatibles.
3. Ejecutar la suite de pruebas y compilación.
4. Verificar que no existan regresiones o fallos en el build.
```

---

## Campos del YAML Frontmatter

| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `name` | String | Sí | Identificador único del agente (en minúsculas con guiones, ej. `dependency-modernizer`). |
| `description` | String | Sí | Explicación clara de lo que hace el agente. Es crucial para el *progressive discovery* y para que el agente coordinador sepa cuándo delegarle tareas. |
| `model` | String | No | Modelo que ejecutará el agente (ej. `flash`, `gemini-3.8-flash`, etc.). Permite optimizar costos y velocidad según la complejidad del rol. |
| `tools` | Lista | No | Lista explícita de herramientas autorizadas (ej. `view_file`, `replace_file_content`, `run_command`, etc.). Evita la confusión y el bloat de contexto al restringir herramientas innecesarias. |
| `skills` | Lista | No | Rutas relativas a habilidades curadas disponibles exclusivamente para este agente (ej. `skills/package-upgrade-rules`). |
| `mainAgent` | Boolean | No | Si es `true`, permite lanzar una sesión primaria interactuando directamente como este agente. |
| `subagent` | Boolean | No | Si es `true`, permite que un agente coordinador invoque dinámicamente a este agente como subagente. |
| `permissionMode` | String | No | Modo de permisos de edición (ej. `acceptEdits`, `bypassPermissions`). |
| `commandExecutionPolicy` | String | No | Política de ejecución de comandos en terminal. Al configurarse como `auto`, permite ejecutar tests y compilación en segundo plano de forma autónoma, manteniendo bajo confirmación manual los comandos destructivos. |

---

## Simetría de Ejecución: Agente Principal vs. Subagente

A diferencia de otros entornos donde los agentes personalizados solo pueden ser subagentes ocultos, Antigravity ofrece **simetría de ejecución**:

### 1. Como Agente Principal (`mainAgent: true`)
Permite interactuar directamente con el agente especializado desde el inicio de la sesión:
* **En el IDE / Desktop App**: Selecciona el agente directamente en el menú desplegable (dropdown) de agentes.
* **En la CLI**:
  ```bash
  agy --agent <nombre-agente>
  # O enviando una tarea inicial directa:
  agy --agent <nombre-agente> "Actualiza las dependencias menores y corre los tests"
  ```

### 2. Como Subagente (`subagent: true`)
Permite que un agente generalista o coordinador delegue tareas complejas a este agente en segundo plano. El coordinador lee la descripción del agente y le transmite el contexto necesario sin contaminar el hilo principal.

---

## Relación: Agentes Personalizados vs. Skills vs. Subagentes Dinámicos

* **Skills**: Proporcionan procedimientos y guías paso a paso (*on-demand*) mediante descubrimiento progresivo para no saturar la ventana de contexto.
* **Subagentes Dinámicos**: Permiten delegar tareas con prompts arbitrarios generados al vuelo por el agente principal.
* **Agentes Personalizados**: Llevan la personalización al nivel estructural: definen el rol, el prompt del sistema, el modelo específico, el subconjunto cerrado de herramientas y las políticas de ejecución seguras.

---

## Guía Paso a Paso para Crear un Agente en este Proyecto

1. Crea la carpeta de agentes si aún no existe:
   ```bash
   mkdir -p .agents/agents
   ```
2. Crea el archivo del agente en `.agents/agents/<nombre-agente>.md`.
3. Define el encabezado YAML frontmatter con los campos requeridos (`name`, `description`, etc.) y las banderas deseadas (`mainAgent`, `subagent`, `tools`, `skills`, `commandExecutionPolicy`).
4. Redacta las directivas del agente en el cuerpo Markdown debajo del frontmatter.
5. Invócalo según sea necesario vía `agy --agent <nombre-agente>` o seleccionándolo en la interfaz.
