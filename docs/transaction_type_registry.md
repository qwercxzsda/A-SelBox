# Finances transaction types

The [registry](../services/sync/src/transaction_types/finances.py) maps a transaction type and its item breakdown path to a component type. The [routing rules](../services/sync/src/finances/routing.py) derive the lookup key from the individual item and the transaction. Liquidation routes all amounts on the item, including tax, through its warehouse barcode.

The checked-in frontend catalog is generated from the same registry.

```sh
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate --check
```
