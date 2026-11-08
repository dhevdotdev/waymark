# Build the interface without a UI framework

The interface is plain TypeScript and CSS. The surface is small, startup and reading performance are the product, and most of the screen is a rendered document or a canvas that a component framework would not help with. Panels are classes that own their DOM, which keeps updates explicit, such as moving one highlight on scroll without re-rendering a list.
