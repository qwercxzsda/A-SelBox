# Using `python-amazon-sp-api`

아마존 SP-API는 인증을 위해 세 개의 credential을 요구한다: CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN
하나의 Seller Central account에서 CLIENT_ID와 CLIENT_SECRET은 유일하다.
하지만 REFRESH_TOKEN은 SP-API endpoint에 따라서 달라진다.
또한, SP-API의 몇몇 API는 marketplace ID 또한 parameter로 받는다.

- CLIENT_ID, CLIENT_SECRET: Seller Central account 당 하나만 발급.
- REFRESH_TOKEN: Endpoint에 따라 달라짐. 단, FE의 Marketplace인 JAPAN, SINGAPORE, AUSTRALIA는 각각 다른 REFRESH_TOKEN을 사용한다.
- Endpoints: 3개 존재. NA, EU, FE.
- Marketplace ID: marketplace에 따라 달라짐. 매우 많음.

따라서, 다음과 같이 credential, endpoint, marketplace를 설정한다:

1. CLIENT_ID, CLIENT_SECRET 설정.
   `Client`를 생성할 때, `python-amazon-sp-api`가 알아서 환경 변수를 읽어 CLIENT_ID와 CLIENT_SECRET을 설정한다.

   ```python
   from dotenv import load_dotenv

   load_dotenv()
   ```

1. REFRESH_TOKEN, SP-API endpoint 설정.
   사용하고자 하는 endpoint와 그에 해당하는 REFRESH_TOKEN을 설정한다.
   `Client`를 생성할 때 parameter로 넘겨준다.
   `python-amazon-sp-api`에서는 직접 endpoint를 설정할 수 없고, marketplace를 통해 간접적으로 endpoint를 설정한다.
   이때 설정하는 marketplace는 API 요청 시에 default로 사용되는 marketplace이다.

   ```python
   client: Reports = Reports(
       marketplace=Marketplaces.US,
       refresh_token=os.getenv("REFRESH_TOKEN_NA"),
   )
   ```

1. Marketplace ID 설정.
   API 요청 시에 marketplace ID를 parameter로 넘겨준다.
   이때, 2번에서 설정한 marketplace가 default로 사용된다.

   ```python
   response = client.get_reports(
       reportTypes=["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"],
       processingStatuses=["DONE"],
       marketplaceIds=[Marketplaces.US.marketplace_id],
       createdSince=created_since,
       pageSize=100,
   )
   ```
