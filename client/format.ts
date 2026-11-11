export const money = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
