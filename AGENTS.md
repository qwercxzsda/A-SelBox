# AGENTS.md

- The service configuration file is `services/sync/.env` (not the repository root). It contains sensitive credentials. Do not inspect, print, or modify it directly. Application code may use `load_dotenv()` and access credentials through environment variables; one-off verification scripts should pass the service file's path explicitly.
- Use the Anaconda environment `A-SelBox` to run the Python scripts.
- If additional packages are needed, install them in the `A-SelBox` environment and update the `env.yml` file.
- For the packages not available in Anaconda, use Docker. Do not install packages natively.
- The first line of the commit message should be of the form `<type>: <subject>`.
- Run all frontend `node`, `npm`, `npx`, `corepack`, and `pnpm` commands inside Docker. Do not run Node or package-manager commands natively on the host. See `services/frontend/user-webpage/README.md` for the commands.
- After making changes, refactor the affected parts.
  - Format and lint
  - Remove redundant code
  - Simplify logic
  - Split files and functions that are long
  - Check if the names are easy to understand
  - Check for consistency and typos
  - Check the overall design of the code
