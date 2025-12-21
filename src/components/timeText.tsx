import React from "react";
import { useLanguage } from "./language-provider";
import { useTimeAgo, useTimeText } from "../hooks/useTime";

export const TimeAgoText: React.FC<{
  time: Date | string | number | null | undefined;
}> = ({ time }) => {
  const { dayjsLocale } = useLanguage();
  const timeAgo = useTimeAgo(dayjsLocale, time);
  return <>{timeAgo}</>;
};

export const TimeText: React.FC<{
  time: Date | string | number | null | undefined;
  format?: string;
}> = ({ time, format = "LLL" }) => {
  const { dayjsLocale } = useLanguage();
  const text = useTimeText(dayjsLocale, time, format);
  return <>{text}</>;
};
