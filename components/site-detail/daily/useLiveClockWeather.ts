"use client";

import { useEffect, useRef, useState } from "react";

import { SITE_CONFIG } from "@/lib/siteConfig";

const { latitude, longitude } = SITE_CONFIG.coords;
const SITE_WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
  "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m" +
  "&timezone=Asia%2FSeoul&wind_speed_unit=ms";

const kstTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const kstDateFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
});

function weatherCodeText(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "부분 흐림";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if ([51, 53, 55, 56, 57].includes(code)) return "이슬비";
  if ([61, 63, 65, 66, 67].includes(code)) return "비";
  if ([71, 73, 75, 77].includes(code)) return "눈";
  if ([80, 81, 82].includes(code)) return "소나기";
  if ([85, 86].includes(code)) return "눈 소나기";
  if ([95, 96, 99].includes(code)) return "뇌우";
  return "날씨 정보";
}

export interface WeatherState {
  main: string;
  detail: string;
}

export function useLiveClockWeather() {
  const [clock, setClock] = useState({ time: "--:--:--", date: "날짜 확인 중" });
  const [weather, setWeather] = useState<WeatherState>({ main: "날씨 불러오는 중", detail: "네트워크 연결 확인 중" });
  const loadingRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock({ time: kstTimeFmt.format(now), date: kstDateFmt.format(now) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setWeather((w) => ({ ...w, main: "날씨 불러오는 중" }));
      try {
        const res = await fetch(SITE_WEATHER_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const c = data.current;
        if (!c) throw new Error("current weather missing");
        const temp = Number(c.temperature_2m).toFixed(1);
        const feel = Number(c.apparent_temperature).toFixed(1);
        const humidity = Math.round(Number(c.relative_humidity_2m));
        const wind = Number(c.wind_speed_10m).toFixed(1);
        const rain = Number(c.precipitation || 0).toFixed(1);
        if (!cancelled) {
          setWeather({
            main: `${weatherCodeText(Number(c.weather_code))} · ${temp}℃`,
            detail: `체감 ${feel}℃ · 습도 ${humidity}% · 바람 ${wind}m/s · 강수 ${rain}mm`,
          });
        }
      } catch {
        if (!cancelled) setWeather({ main: "날씨 연결 안됨", detail: "인터넷 연결 후 자동으로 다시 시도합니다." });
      } finally {
        loadingRef.current = false;
      }
    }
    refresh();
    const id = setInterval(refresh, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { clock, weather };
}
