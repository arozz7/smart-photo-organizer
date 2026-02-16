# UI Navigation Flow

```mermaid
flowchart TD
    Start[User Opens App] --> Splash[Loading Screen]
    Splash --> Layout[Main Layout]

    subgraph Navigation
        Layout --> Home[Home Dashboard]
        Layout --> Library[Library View (Grid)]
        Layout --> Search[Search View]
        Layout --> People[People View]
        Layout --> Create[Create View]
        Layout --> Locations[Locations View]
        Layout --> Queues[Queues View]
        Layout --> Settings[Settings View]
    end

    subgraph Detail Views
        People --> PersonDetail[Person Detail View]
        Library --> Lightbox[Photo Lightbox (Modal)]
        Lightbox --> Enhance[Enhance Lab]
    end

    subgraph Modals
        Settings --> ScanWarnings[Scan Warnings Modal]
        Settings --> SettingsModal[Advanced Settings Modal]
        Library --> Filter[Filter Panel]
    end

    PersonDetail --> Lightbox
    Search --> Lightbox
```
