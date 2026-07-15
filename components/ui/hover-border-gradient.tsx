"use client";
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

export function HoverBorderGradient({
  children,
  className,
  containerClassName,
  as: Tag = "button",
  duration = 1,
  clockwise = true,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  containerClassName?: string;
  as?: any;
  duration?: number;
  clockwise?: boolean;
}) {
  const [hovered, setHovered] = useState<boolean>(false);
  const [direction, setDirection] = useState<Direction>("TOP");

  const rotateDirection = (currentDirection: Direction): Direction => {
    const directions: Direction[] = ["TOP", "RIGHT", "BOTTOM", "LEFT"];
    const idx = directions.indexOf(currentDirection);
    const nextIdx = clockwise
      ? (idx + 1) % directions.length
      : (idx - 1 + directions.length) % directions.length;
    return directions[nextIdx];
  };

  useEffect(() => {
    if (!hovered) return;

    const interval = setInterval(() => {
      setDirection((prevState) => rotateDirection(currentDirectionToDirection(prevState)));
    }, duration * 1000);

    return () => clearInterval(interval);
  }, [hovered]);

  const currentDirectionToDirection = (dir: Direction): Direction => {
    return dir;
  };

  const mapDirectionToGradient = (dir: Direction) => {
    const gradients = {
      TOP: "radial-gradient(20% 50% at 50% 0%, #3b82f6 0%, rgba(59, 130, 246, 0) 100%)",
      LEFT: "radial-gradient(50% 20% at 0% 50%, #6366f1 0%, rgba(99, 102, 241, 0) 100%)",
      BOTTOM: "radial-gradient(20% 50% at 50% 100%, #ec4899 0%, rgba(236, 72, 153, 0) 100%)",
      RIGHT: "radial-gradient(50% 20% at 100% 50%, #8b5cf6 0%, rgba(139, 92, 246, 0) 100%)",
    };
    return gradients[dir];
  };

  const highlight =
    "radial-gradient(75% 75% at 50% 50%, #3b82f6 0%, rgba(99, 102, 241, 1) 100%)";

  return (
    <Tag
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex rounded-xl content-center bg-black/5 hover:bg-black/10 transition duration-500 dark:bg-white/5 items-center justify-center p-[1px] overflow-hidden",
        containerClassName
      )}
      {...props}
    >
      <div
        className={cn(
          "w-full text-white px-8 py-3 rounded-xl z-10 bg-slate-900 dark:bg-slate-950 flex items-center justify-center gap-2",
          className
        )}
      >
        {children}
      </div>
      <motion.div
        className={cn(
          "absolute inset-0 z-0 pointer-events-none"
        )}
        style={{
          filter: "blur(2px)",
          position: "absolute",
          width: "100%",
          height: "100%",
        }}
        animate={{
          background: hovered
            ? [mapDirectionToGradient(direction), highlight]
            : "radial-gradient(20% 50% at 50% 0%, #3b82f6 0%, rgba(59, 130, 246, 0) 100%)",
        }}
        transition={{ ease: "linear", duration: duration ?? 1 }}
      />
      <div className="bg-black absolute inset-[1px] rounded-xl z-1" />
    </Tag>
  );
}
