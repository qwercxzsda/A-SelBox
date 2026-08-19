# AGENTS.md

- The `.env` file contains sensitive credentials. Do not inspect, print, or modify it directly. Application code may use `load_dotenv()` and access credentials through environment variables.
- Use the conda environment `A-SelBox` to run the Python scripts.
- If additional packages are needed, install them in the `A-SelBox` environment and update the `env.yml` file.
- After making changes, format and lint the files. Read the relevant `README.md` files for details.
- After making changes, refactor the affected code as appropriate.
  - Remove redundant code
  - Simplify logic
  - Split files and functions that are long
  - Check if the names are easy to understand
  - Check for consistency and typos
  - Check the overall design of the code
