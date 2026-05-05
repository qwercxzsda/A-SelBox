# Using `python-amazon-sp-api`

Amazon SP-API needs three credentials for authentication: CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN.
For a Seller Central account, there is only one CLIENT_ID and CLIENT_SECRET.
However, the REFRESH_TOKEN differs according to the SP-API endpoint.

Also, some SP-API endpoints require us to specify marketplace IDs.
Marketplace IDs differ based on the marketplaces (there are many), not the endpoints (there are only 3).
Thus, we use the following approach:

1. Configure the CLIENT_ID and the CLIENT_SECRET. When creating a `Client`, `python-amazon-sp-api` configures the CLIENT_ID and the CLIENT_SECRET from the environment variables.

```python
from dotenv import load_dotenv

load_dotenv()
```

2. Configure the REFRESH_TOKEN and the SP-API endpoint (NA, EU, FE). Specify the REFRESH_TOKEN according to the endpoint we wish to use. We specify the endpoint by specifying the marketplace, but we will manually specify the marketplaces in the following step.

```python

```

3. When requesting through the client, specify the marketplaces we wish to use.
