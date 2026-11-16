import { lazy } from "react";
import { Coins } from "lucide-react";
import { defineDeskModule } from "../../core/registry";

// Hiding this module is cosmetic (requires: "top"); every lmmx_top_* call is enforced on the server.
// eslint-disable-next-line react-refresh/only-export-components
export default defineDeskModule({
  path: "lipa-mdogo-top", label: "Lipa Mdogo Mdogo (top desk)", description: "Review landlord details, tenants, audit log, leads and stats.",
  icon: Coins, order: 101, requires: "top", component: lazy(() => import("./TopLmmScreen")),
});
