---
trigger: glob
---

# Java Enterprise Standards
(Activation: Glob `**/*.java`)

## Code Style
- **Modern Java:** Use Java 17+ features (Records, Switch expressions, `var` for local variables where type is obvious).
- **Lombok:** Use Lombok (`@Data`, `@Builder`, `@Slf4j`) to reduce boilerplate, but do not overuse `@AllArgsConstructor`.
- **Streams:** Prefer Stream API for collection processing over standard for-loops.

## Architecture
- **SOLID:** Strictly adhere to SOLID principles. Dependency Injection is mandatory.
- **Optional:** Use `Optional<T>` for return types that might be null. Never return `null` from public methods.
- **Immutability:** Fields should be `final` wherever possible.

## Security
- **Serialization:** Avoid Java Native Serialization. Use JSON (Jackson/Gson) instead.
- **XXE:** Disable DTDs in all XML parsers (SAX/DOM).

## 🛑 What Not To Do
- Do not catch `Throwable` or `Error`. Catch specific Exceptions.
- Do not use `System.out.println`. Use SLF4J/Logback.
- Do not hardcode file separators (`/` or `\`). Use `File.separator`.