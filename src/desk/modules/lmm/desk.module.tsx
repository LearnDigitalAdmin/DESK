import { lazy } from "react";
import { Coins } from "lucide-react";
import { defineDeskModule } from "../../core/registry";

// The registry loads every desk.module.tsx and reads its default export; that is the module contract.
// eslint-disable-next-line react-refresh/only-export-components
export default defineDeskModule({
  path: "lipa-mdogo", label: "Lipa Mdogo Mdogo", description: "Sign up tenants who pay rent in small amounts, and see what your desk earns.",
  icon: Coins, order: 35, component: lazy(() => import("./LmmScreen")),
});
