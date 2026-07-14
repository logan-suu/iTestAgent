# mocks/

Mock backend implementations and test doubles.

## Location convention

Per architecture doc §5.1, `MockBackend` is listed as a DeviceBackend implementation candidate. The mock backend package will live at `packages/itestagent-backends/device-mock/` (to be created in Task 3.3a) alongside other backend implementations.

This `mocks/` directory is reserved for:
- Cross-backend mock fixtures not tied to a specific backend package
- Integration test mocks that span multiple backends
- Test helper scripts

Mock fixtures that are backend-specific (e.g., mobile-mcp response samples) live in `fixtures/<backend-name>/`.
