import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("orchmesh-theme") === "dark";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("orchmesh-theme", dark ? "dark" : "light");
    } catch {
      /* Theme remains usable when browser storage is unavailable. */
    }
  }, [dark]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="ml-auto"
      aria-label={dark ? "切换浅色主题" : "切换深色主题"}
      title={dark ? "切换浅色主题" : "切换深色主题"}
      onClick={() => setDark((value) => !value)}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
